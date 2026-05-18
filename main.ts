async function jobArrived(s: Switch, flowElement: FlowElement, job: Job) {
    try {
        // Get job path to read file contents
        const jobPath = await job.get(AccessLevel.ReadOnly);
        
        // Parse XML to check for Yard Signs
        let hasYardSigns = false;
        
        // Try to read and parse as XML if it's a data file
        try {
            const xmlDoc = XmlDocument.open(jobPath);
            const itemType = xmlDoc.evaluate("//itemType/text()");
            const orderQty = xmlDoc.evaluate("//orderQty/text()");
            
            if (itemType === "Yard Signs" && orderQty && Number(orderQty) > 0) {
                hasYardSigns = true;
            }
        } catch (e) {
            // If not XML or parse fails, continue without error
        }
        
        // Determine LargeBoxFee value
        const largeBoxFee = hasYardSigns ? 15 : 0;
        
        // Generate AdditionalCharges dataset
        await generateAdditionalChargesDataset(job, largeBoxFee);
        
        // Build ToEPMS SOAP envelope for API upload
        await buildToEPMSDataset(s, flowElement, job, largeBoxFee);
    } catch (error: any) {
        job.fail("Error processing job: %1", [error?.message || String(error)]);
    }
}

/**
 * Generates the AdditionalCharges dataset containing only the LargeBoxFee
 */
async function generateAdditionalChargesDataset(job: Job, largeBoxFee: number): Promise<void> {
    try {
        // Create AdditionalCharges dataset with only LargeBoxFee
        const additionalChargesData = {
            LargeBoxFee: largeBoxFee
        };
        
        // Store in private data
        await job.setPrivateData("AdditionalCharges", additionalChargesData);
        
        await job.log(LogLevel.Info, "AdditionalCharges dataset generated with LargeBoxFee: %1", [String(largeBoxFee)]);
    } catch (error: any) {
        await job.log(LogLevel.Error, "Error generating AdditionalCharges dataset: %1", [error?.message || String(error)]);
        throw error;
    }
}

/**
 * Builds the ToEPMS dataset in SOAP format for EPMS API upload
 * Handles multiple packages from FedEx shipment data
 */
async function buildToEPMSDataset(s: Switch, flowElement: FlowElement, job: Job, largeBoxFee: number) {
    try {
        // Get job path and read XML data
        const jobPath = await job.get(AccessLevel.ReadOnly);
        
        // Parse job as XML
        let xmlDoc = XmlDocument.open(jobPath);
        
        // Extract shipment info using XPath
        const epmsJobNumber = xmlDoc.evaluate("//EPMSjobNumber/text()") || job.getId();
        const customer = xmlDoc.evaluate("//Customer/text()") || "AMPACT";
        const propagoJobNumber = xmlDoc.evaluate("//PropagoJobNumber/text()") || "";
        const beginDate = xmlDoc.evaluate("//BeginDate/text()") || new Date().toLocaleDateString();
        const endDate = xmlDoc.evaluate("//EndDate/text()") || new Date().toLocaleDateString();
        
        // Get stored FedEx shipment data if available
        let fedExDataJson = "";
        try {
            const fedExPrivateData = await job.getPrivateData("FedExShipmentData");
            fedExDataJson = fedExPrivateData && fedExPrivateData.length > 0 ? fedExPrivateData[0]?.value : "{}";
        } catch (e) {
            fedExDataJson = "{}";
        }
        
        const fedExData = typeof fedExDataJson === "string" ? JSON.parse(fedExDataJson) : fedExDataJson;
        
        // Build SOAP envelope
        let soapBody = buildSOAPEnvelope(
            String(epmsJobNumber),
            String(customer),
            String(propagoJobNumber),
            String(beginDate),
            String(endDate),
            fedExData.Packages || [],
            {},
            {},
            largeBoxFee,
            { Username: "test", Password: "test" }
        );
        
        // Store the SOAP body in private data for API submission
        await job.setPrivateData("ToEPMS_SOAPEnvelope", soapBody);
        
        // Log successful dataset construction
        await job.log(LogLevel.Info, "ToEPMS dataset built successfully for job %1 with %2 package(s)", 
            [String(epmsJobNumber), String(fedExData.Packages?.length || 0)]);
        
        return soapBody;
    } catch (error: any) {
        await job.log(LogLevel.Error, "Error building ToEPMS dataset: %1", [error?.message || String(error)]);
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
            <Username>${credentials.Username}</Username>
            <Password>${credentials.Password}</Password>
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
