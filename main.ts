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
}
