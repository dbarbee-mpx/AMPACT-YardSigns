async function jobArrived(s: Switch, flowElement: FlowElement, job: Job) {
    // Get all items in the job
    const items = job.getItems();
    
    // Check if any item has itemType == 'Yard Signs' AND orderQty > 0
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemType = item.get("itemType");
        const orderQty = item.get("orderQty");
        
        // If both conditions are met, set LargeBoxFee to 15
        if (itemType === "Yard Signs" && orderQty > 0) {
            job.set("LargeBoxFee", 15);
            break;
        }
    }
    
    // Build ToEPMS SOAP envelope for API upload
    await buildToEPMSDataset(s, job);
}

/**
 * Builds the ToEPMS dataset in SOAP format for EPMS API upload
 * Handles multiple packages from FedEx shipment data
 * 
 * This script processes the PropagoOrder dataset and adds AdditionalCharges
 * if any order line item has itemType "Yard Signs", the fee is set to 15.
 * Otherwise, the default fee is 0.
 */
async function buildToEPMSDataset(s: Switch, job: Job) {
    try {
        // Get shipment data from job metadata
        const fedExData = job.get("FedExShipmentData") || {};
        const epmsShipData = job.get("EPMSShipData") || {};
        const additionalCharges = job.get("AdditionalCharges") || {};
        const credentials = job.get("APICredentials") || { Username: "test", Password: "test" };
        
        // Get the LargeBoxFee from job (only applies to first package)
        const largeBoxFee = job.get("LargeBoxFee") || 0;
        
        // Extract shipment info
        const epmsJobNumber = fedExData.EPMSjobNumber || job.get("JobNumber");
        const customer = fedExData.Customer || "AMPACT";
        const propagoJobNumber = fedExData.PropagoJobNumber || "";
        const beginDate = fedExData.BeginDate || new Date().toLocaleDateString();
        const endDate = fedExData.EndDate || new Date().toLocaleDateString();
        const packages = fedExData.Packages || [];
        
        // Build SOAP envelope
        let soapBody = buildSOAPEnvelope(
            epmsJobNumber,
            customer,
            propagoJobNumber,
            beginDate,
            endDate,
            packages,
            epmsShipData,
            additionalCharges,
            largeBoxFee,
            credentials
        );
        
        // Store the SOAP body in job metadata for API submission
        job.set("ToEPMS_SOAPEnvelope", soapBody);
        
        // Log successful dataset construction
        s.log(3, `ToEPMS dataset built successfully for job ${epmsJobNumber} with ${packages.length} package(s)`);
        
        return soapBody;
    } catch (error) {
        s.log(1, `Error building ToEPMS dataset: ${error.message}`);
        throw error;
    }
}

/**
 * Constructs the complete SOAP XML envelope for EPMS API
 * Includes for-loop logic to handle multiple packages
 * LargeBoxFee is only applied to the first package
 */
function buildSOAPEnvelope(
    epmsJobNumber: string,
    customer: string,
    propagoJobNumber: string,
    beginDate: string,
    endDate: string,
    packages: any[],
    epmsShipData: any,
    additionalCharges: any,
    largeBoxFee: number,
    credentials: any
): string {
    // Build package elements with for-loop iteration
    let packagesXML = "";
    for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        
        // Only add LargeBoxFee to the first package (i === 0)
        const boxFee = i === 0 ? largeBoxFee : 0;
        
        const freightCost = calculateFreightCost(
            pkg.LTOT || 0,
            epmsShipData.FreightCost || 0,
            boxFee
        );
        
        packagesXML += `
                <Package>
                    <JobNumber>${epmsJobNumber}</JobNumber>
                    <FreightCost>${freightCost}</FreightCost>
                    <ShipDate>${endDate}</ShipDate>
                    <TrackingNumber>${pkg.TrackingNumber || ""}</TrackingNumber>
                    <ShipVia>${epmsShipData.ShipVia || "FedEx"}</ShipVia>
                    <ShipViaService>${epmsShipData.ShipViaService || ""}</ShipViaService>
                </Package>`;
    }
    
    // Construct full SOAP envelope
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <UpdateShipmentByJobNumber xmlns="http://localhost/EnterpriseWebService/Enterprise Connect">
        <Credentials>
            <Username>test</Username>
            <Password>test</Password>
        </Credentials>
        <strJobNumber>${epmsJobNumber}</strJobNumber>
        <Ships>
            <Shipment>
                <JobNumber>${epmsJobNumber}</JobNumber>
                <ShipVia>${epmsShipData.ShipVia || "FedEx"}</ShipVia>
                <ShipViaService>${epmsShipData.ShipViaService || ""}</ShipViaService>
                <ShipDate>${endDate}</ShipDate>
                <Packages>${packagesXML}
                </Packages>
            </Shipment>
        </Ships>
    </UpdateShipmentByJobNumber>
  </soap:Body>
</soap:Envelope>`;
    
    return soapEnvelope;
}

/**
 * Calculates total freight cost from multiple sources
 * Combines FedEx base cost + EPMS surcharges + additional fees
 */
function calculateFreightCost(fedExCost: number, epmsCost: number, additionalFee: number): number {
    return parseFloat((fedExCost + epmsCost + additionalFee).toFixed(2));
}
