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
 */
async function buildToEPMSDataset(s: Switch, job: Job) {
    try {
        // Get shipment data from job metadata
        const fedExData = job.get("FedExShipmentData") || {};
        const epmsShipData = job.get("EPMSShipData") || {};
        const additionalCharges = job.get("AdditionalCharges") || { LargeBoxFee: 0 };
        const credentials = job.get("APICredentials") || { Username: "test", Password: "test" };
        
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
    credentials: any
): string {
    // Build package elements with for-loop iteration
    let packagesXML = "";
    for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        const freightCost = calculateFreightCost(
            pkg.LTOT || 0,
            epmsShipData.FreightCost || 0,
            additionalCharges.LargeBoxFee || 0
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
            <Username>${credentials.Username}</Username>
            <Password>${credentials.Password}</Password>
        </Credentials>
        <strJobNumber>${epmsJobNumber}</strJobNumber>
        <Ships>
            <Shipment>
                <JobNumber>${epmsJobNumber}</JobNumber>
                <Customer>${customer}</Customer>
                <PropagoJobNumber>${propagoJobNumber}</PropagoJobNumber>
                <BeginDate>${beginDate}</BeginDate>
                <EndDate>${endDate}</EndDate>
                <ShipVia>${epmsShipData.ShipVia || "FedEx"}</ShipVia>
                <ShipViaService>${epmsShipData.ShipViaService || ""}</ShipViaService>
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
