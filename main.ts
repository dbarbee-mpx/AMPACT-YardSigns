import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const writeFile = promisify(fs.writeFile);

/**
 * Enfocus Switch 25.11 - Yard Signs Large Box Fee Calculator
 * 
 * This script processes the PropagoOrder dataset and creates an AdditionalCharges dataset
 * with a LargeBoxFee. If any order line item has itemType "Yard Signs", the fee is set to 15.
 * Otherwise, the default fee is 0.
 */

/**
 * Main entry point - triggered when a job arrives in the flow element
 */
async function jobArrived(s: Switch, flowElement: FlowElement, job: Job): Promise<void> {
    try {
        await flowElement.log(LogLevel.Debug, `Processing job: %1`, [job.getName()]);

        // Get the PropagoOrder dataset from the job
        const datasets = await job.listDatasets();
        await flowElement.log(LogLevel.Debug, `Available datasets: %1`, [datasets.length.toString()]);

        const propagoDataset = datasets.find(ds => ds.name === 'PropagoOrder');

        if (!propagoDataset) {
            await flowElement.log(LogLevel.Warning, 'PropagoOrder dataset not found for job: %1', [job.getName()]);
            // Set default fee of 0 even if dataset is missing
            await createAdditionalChargesDataset(s, flowElement, job, 0);
            await job.sendToSingle();
            return;
        }

        // Get the PropagoOrder dataset content
        const datasetPath = await job.getDataset('PropagoOrder', AccessLevel.ReadOnly);
        await flowElement.log(LogLevel.Debug, `Retrieved PropagoOrder dataset from: %1`, [datasetPath]);

        // Read and parse the dataset
        const datasetContent = fs.readFileSync(datasetPath, 'utf-8');
        const propagoData = JSON.parse(datasetContent);

        await flowElement.log(LogLevel.Debug, `Parsed PropagoOrder dataset successfully`);

        // Extract orderLines from the dataset
        const orderLines = propagoData?.results?.orderLines || [];
        await flowElement.log(LogLevel.Debug, `Found %1 order lines`, [orderLines.length.toString()]);

        // Check if any order line has itemType "Yard Signs"
        let largeBoxFee = 0;
        let yardSignsFound = false;

        for (let i = 0; i < orderLines.length; i++) {
            const orderLine = orderLines[i];
            const itemType = orderLine?.part?.itemType || '';

            await flowElement.log(LogLevel.Debug, `Order line %1: itemType = %2`, [i.toString(), itemType]);

            if (itemType === 'Yard Signs') {
                yardSignsFound = true;
                largeBoxFee = 15;
                await flowElement.log(LogLevel.Info, `Yard Signs detected at order line %1, setting LargeBoxFee to 15`, [i.toString()]);
                break; // Found Yard Signs, no need to continue
            }
        }

        if (!yardSignsFound) {
            await flowElement.log(LogLevel.Info, `No Yard Signs found in order lines, LargeBoxFee remains 0`);
        }

        // Create the AdditionalCharges dataset
        await createAdditionalChargesDataset(s, flowElement, job, largeBoxFee);

        // Route the job
        await job.sendToSingle();
        await flowElement.log(LogLevel.Info, `Job %1 processed successfully with LargeBoxFee: %2`, [job.getName(), largeBoxFee.toString()]);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await flowElement.log(LogLevel.Error, `Error processing job %1: %2`, [job.getName(), errorMessage]);
        job.fail(`Failed to process order lines: ${errorMessage}`, []);
    }
}

/**
 * Creates the AdditionalCharges dataset with the calculated LargeBoxFee
 */
async function createAdditionalChargesDataset(
    s: Switch,
    flowElement: FlowElement,
    job: Job,
    largeBoxFee: number
): Promise<void> {
    try {
        // Create the AdditionalCharges dataset structure
        const additionalCharges = {
            AdditionalCharges: {
                LargeBoxFee: largeBoxFee.toString()
            }
        };

        // Create a temporary file for the dataset
        const tempDir = await flowElement.createPathWithName('AdditionalCharges', true);
        const datasetFilePath = path.join(tempDir, 'AdditionalCharges.json');

        // Write the dataset to a file
        await writeFile(datasetFilePath, JSON.stringify(additionalCharges, null, 2));

        await flowElement.log(LogLevel.Debug, `Created temporary dataset file at: %1`, [datasetFilePath]);

        // Create the dataset for the job
        await job.createDataset('AdditionalCharges', datasetFilePath, DatasetModel.JSON);

        await flowElement.log(LogLevel.Info, `AdditionalCharges dataset created with LargeBoxFee: %1`, [largeBoxFee.toString()]);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await flowElement.log(LogLevel.Error, `Error creating AdditionalCharges dataset: %1`, [errorMessage]);
        throw error;
    }
}

/**
 * Optional: Timer fired entry point for periodic processing
 * Uncomment if you need to process jobs on a timer
 */
async function timerFired(s: Switch, flowElement: FlowElement): Promise<void> {
    try {
        await flowElement.log(LogLevel.Debug, `Timer fired for flow element: %1`, [flowElement.getName()]);
        // Add any periodic processing logic here
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await flowElement.log(LogLevel.Error, `Error in timerFired: %1`, [errorMessage]);
    }
}

/**
 * Optional: Flow start triggered entry point
 * Uncomment if you need to initialize when the flow starts
 */
async function flowStartTriggered(s: Switch, flowElement: FlowElement): Promise<void> {
    try {
        await flowElement.log(LogLevel.Info, `Flow started: %1`, [flowElement.getName()]);
        // Add any initialization logic here
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await flowElement.log(LogLevel.Error, `Error in flowStartTriggered: %1`, [errorMessage]);
    }
}

export { jobArrived, timerFired, flowStartTriggered };
