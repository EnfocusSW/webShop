"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios = __importStar(require("axios"));
const fs_1 = require("fs");
const tmp = __importStar(require("tmp"));
const js2xmlparser = __importStar(require("js2xmlparser"));
const BASE_URL = "https://www.eCommerce.com";
//Is always required even if the function is not used (timer fired)
async function jobArrived(s, flowElement, job) { }
//main code for polling
async function timerFired(s, flowElement) {
    //get the properties
    let method = (await flowElement.getPropertyStringValue("method"));
    //define the variables
    let timerInterval;
    if (method == "Webhook") {
        //define timerInterval
        timerInterval = 2592000; //30 days
        //set flow timer interval
        flowElement.setTimerInterval(timerInterval);
        //exit the script
        return;
    }
    else if ((method = "Polling")) {
        //get the properties
        let apiKey = (await flowElement.getPropertyStringValue("apiKey"));
        let pollingInterval = (await flowElement.getPropertyStringValue("pollingInterval"));
        let datasetType = (await flowElement.getPropertyStringValue("datasetType"));
        let datasetName = (await flowElement.getPropertyStringValue("datasetName"));
        //define the variables
        let eCommerceOrders, tmpFilePath = "", tmpDatasetPath = "";
        //define the timerInterval
        timerInterval = Number(pollingInterval) * 60;
        //set flow timer interval
        flowElement.setTimerInterval(timerInterval);
        //define tmpFilePath
        tmpFilePath = tmp.fileSync({ discardDescriptor: true }).name;
        //define tmpDatasetPath
        tmpDatasetPath = tmp.fileSync({ discardDescriptor: true }).name;
        //function to get the list of orders
        try {
            let response = await getOrders(flowElement, BASE_URL, apiKey);
            eCommerceOrders = response;
        }
        catch (error) {
            if (error.response) {
                if (error.response.status === 400) {
                    await flowElement.failProcess(`Error ID: ${error.response.data.ErrorId} | ${error.response.data.Reason}`);
                    return;
                }
                else if (error.response.status === 401) {
                    await flowElement.failProcess(`Unauthorized to access this site`);
                    return;
                }
                else if (error.response.status === 403) {
                    await flowElement.failProcess(`Response status: ${error.response.status} | Check if you are using a valid API Key`);
                    return;
                }
                else {
                    await flowElement.failProcess(`Job processing encountered an issue`);
                    return;
                }
            }
            else {
                await flowElement.failProcess(`Job processing encountered an issue`);
                return;
            }
        }
        //every order in the array as individual job in Switch
        if (eCommerceOrders && eCommerceOrders.length > 0) {
            // Process each order sequentially
            for (let i = 0; i < eCommerceOrders.length; i++) {
                //define values
                let downloadURL = eCommerceOrders[i].fileURL;
                let jobName = eCommerceOrders[i].fileName;
                //function to download the asset
                try {
                    let response = await downloadFile(flowElement, downloadURL);
                    await writeFile(response.data, tmpFilePath);
                }
                catch (error) {
                    if (error.response) {
                        await flowElement.log(LogLevel.Error, `Error ID: ${error.response.data.ErrorId} | ${error.response.data.Reason}`);
                    }
                    else {
                        await flowElement.log(LogLevel.Error, `Job processing encountered an issue`);
                    }
                }
                //send to flow
                try {
                    let newJob = await flowElement.createJob(tmpFilePath);
                    if (datasetType == "XML") {
                        let xmlString = js2xmlparser.parse("eCommerce", eCommerceOrders[i]);
                        (0, fs_1.writeFileSync)(tmpDatasetPath, xmlString);
                        await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.XML);
                    }
                    else if (datasetType == "JSON") {
                        (0, fs_1.writeFileSync)(tmpDatasetPath, JSON.stringify(eCommerceOrders[i]));
                        await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.JSON);
                    }
                    await newJob.sendToData(Connection.Level.Success, jobName);
                }
                catch (error) {
                    await flowElement.log(LogLevel.Error, `Job could not be created`);
                    return;
                }
                //remove the temp file
                if ((0, fs_1.existsSync)(tmpFilePath)) {
                    (0, fs_1.unlinkSync)(tmpFilePath);
                }
                //remove the temp Dataset
                if ((0, fs_1.existsSync)(tmpDatasetPath)) {
                    (0, fs_1.unlinkSync)(tmpDatasetPath);
                }
            }
        }
        else {
            await flowElement.log(LogLevel.Info, `No new eCommerce orders found`);
            return;
        }
    }
}
//main code for webhook
async function flowStartTriggered(s, flowElement) {
    //get the properties
    let method = (await flowElement.getPropertyStringValue("method"));
    if (method == "Polling") {
        //exit the script
        return;
    }
    else if (method == "Webhook") {
        //get the properties
        let apiKey = (await flowElement.getPropertyStringValue("apiKey"));
        //define webhook path
        let webhookPath = "/eCommerce";
        try {
            //subscribe to webhook path
            await s.httpRequestSubscribe(HttpRequest.Method.POST, webhookPath, [apiKey]);
        }
        catch (error) {
            flowElement.failProcess(`Failed to subscribe to the request %1`, error.message);
        }
        await flowElement.log(LogLevel.Info, `Subscription started on /scripting${webhookPath}`);
    }
}
//Sends back the initial response, the response will be different if the uuid already exists in global data.
async function httpRequestTriggeredSync(request, args, response, s) {
    let eCommerceData = request.getBodyAsString();
    let eCommerceParse = JSON.parse(eCommerceData);
    let jobID = eCommerceParse.orderId.toString();
    //store jobID in global data
    let processedIDS = {};
    let idsFromGlobalData = await s.getGlobalData(Scope.FlowElement, "uuids");
    if (idsFromGlobalData !== "") {
        processedIDS = JSON.parse(idsFromGlobalData);
    }
    //check if jobID already exists
    if (jobID in processedIDS == true) {
        response.setStatusCode(418);
        response.setHeader("Content-Type", "application/json");
        response.setHeader("api_token", args[0]);
        response.setBody(Buffer.from(JSON.stringify({ result: "error", message: `eCommerce order with UUID ${jobID} already exists`, apiKey: args[0] }))); //args comes from the arguments when subscribing to the webhook
    }
    else {
        response.setStatusCode(200);
        response.setHeader("Content-Type", "application/json");
        response.setHeader("api_token", args[0]);
        response.setBody(Buffer.from(JSON.stringify({ result: "success", orderID: jobID, api_token: args[0] })));
        processedIDS[jobID] = { arrival: new Date().getTime(), product: eCommerceParse.product.productName };
        await s.setGlobalData(Scope.FlowElement, "uuids", JSON.stringify(processedIDS));
    }
}
//Processes the request by downloading the production file from the defined url and injecting in the flow while at the same time attaching the product description as a dataset
async function httpRequestTriggeredAsync(request, args, s, flowElement) {
    //get the properties
    let datasetType = (await flowElement.getPropertyStringValue("datasetType"));
    let datasetName = (await flowElement.getPropertyStringValue("datasetName"));
    //define variables
    let tmpFilePath = "", tmpDatasetPath = "", metaData;
    //Parse JSON from Body
    let eCommerceData = request.getBodyAsString();
    metaData = JSON.parse(eCommerceData);
    //define variables
    let downloadPath = metaData.filelocation;
    let downloadFileName = metaData.filename.split("/").pop();
    let jobID = metaData.orderId;
    //define tmpFilePath
    tmpFilePath = tmp.fileSync({ discardDescriptor: true }).name;
    //define tmpDatasetPath
    tmpDatasetPath = tmp.fileSync({ discardDescriptor: true }).name;
    //Download pdf file
    try {
        await flowElement.log(LogLevel.Info, `Download of job ${jobID} in progress`);
        let response = await downloadFile(flowElement, downloadPath);
        await writeFile(response.data, tmpFilePath);
        await flowElement.log(LogLevel.Info, `Download of job ${jobID} finished`);
    }
    catch (error) {
        if (error.response) {
            await flowElement.log(LogLevel.Error, `Error ID: ${error.response.data.ErrorId} | ${error.response.data.Reason}`);
        }
        else {
            await flowElement.log(LogLevel.Error, `Job processing encountered an issue`);
        }
        return;
    }
    //Create job containing the production file and define dataset
    try {
        let newJob = await flowElement.createJob(tmpFilePath);
        if (datasetType == "XML") {
            let xmlString = js2xmlparser.parse("eCommerce", metaData);
            (0, fs_1.writeFileSync)(tmpDatasetPath, xmlString);
            await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.XML);
        }
        else if (datasetType == "JSON") {
            (0, fs_1.writeFileSync)(tmpDatasetPath, JSON.stringify(metaData));
            await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.JSON);
        }
        await newJob.sendToData(Connection.Level.Success, downloadFileName);
    }
    catch (error) {
        await flowElement.log(LogLevel.Error, `Job could not be created`);
        return;
    }
    //remove the temp file
    if ((0, fs_1.existsSync)(tmpFilePath)) {
        (0, fs_1.unlinkSync)(tmpFilePath);
    }
    //remove the temp Dataset
    if ((0, fs_1.existsSync)(tmpDatasetPath)) {
        (0, fs_1.unlinkSync)(tmpDatasetPath);
    }
}
//get orders
async function getOrders(flowElement, baseURL, apiKey) {
    //define URL
    let URL = `${baseURL}/orders`;
    try {
        let result = await axios.default.get(URL, {
            maxBodyLength: Infinity,
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });
        return result.data;
    }
    catch (error) {
        throw error;
    }
}
//download asset
async function downloadFile(flowElement, downloadURL) {
    try {
        let result = await axios.default.get(downloadURL, {
            maxBodyLength: Infinity,
            headers: {},
            responseType: "stream",
        });
        return result;
    }
    catch (error) {
        throw error;
    }
}
//streaming the downloaded translated file to tmpfile
const writeFile = async (data, savePath) => {
    return new Promise((resolve, reject) => {
        const writer = (0, fs_1.createWriteStream)(savePath);
        data.pipe(writer);
        let error = null;
        writer.on("error", (err) => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on("close", () => {
            if (!error) {
                resolve(true);
            }
        });
    });
};
//# sourceMappingURL=main.js.map