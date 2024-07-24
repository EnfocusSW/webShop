import * as axios from "axios";
declare type AxiosError = { request: any; response: any; data: any; error: any };
import { createWriteStream, writeFileSync, existsSync, unlinkSync } from "fs";
import * as tmp from "tmp";
import * as js2xmlparser from "js2xmlparser";

const BASE_URL = "https://www.eCommerce.com";

//Is always required even if the function is not used (timer fired)
async function jobArrived(s: Switch, flowElement: FlowElement, job: Job) {}

//main code for polling
async function timerFired(s: Switch, flowElement: FlowElement): Promise<void> {
  //get the properties
  let method: string = (await flowElement.getPropertyStringValue("method")) as string;

  //define the variables
  let timerInterval: number;

  if (method == "Webhook") {
    //define timerInterval
    timerInterval = 2592000; //30 days

    //set flow timer interval
    flowElement.setTimerInterval(timerInterval);

    //exit the script
    return;
  } else if ((method = "Polling")) {
    //get the properties
    let apiKey: string = (await flowElement.getPropertyStringValue("apiKey")) as string;
    let pollingInterval: string = (await flowElement.getPropertyStringValue("pollingInterval")) as string;
    let datasetType: string = (await flowElement.getPropertyStringValue("datasetType")) as string;
    let datasetName: string = (await flowElement.getPropertyStringValue("datasetName")) as string;

    //define the variables
    let eCommerceOrders: any,
      tmpFilePath: string = "",
      tmpDatasetPath: string = "";

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
    } catch (error) {
      if ((error as AxiosError).response) {
        if ((error as AxiosError).response!.status === 400) {
          await flowElement.failProcess(`Error ID: ${(error as AxiosError).response.data.ErrorId} | ${(error as AxiosError).response.data.Reason}`);
          return;
        } else if ((error as AxiosError).response!.status === 401) {
          await flowElement.failProcess(`Unauthorized to access this site`);
          return;
        } else if ((error as AxiosError).response!.status === 403) {
          await flowElement.failProcess(`Response status: ${(error as AxiosError).response!.status} | Check if you are using a valid API Key`);
          return;
        } else {
          await flowElement.failProcess(`Job processing encountered an issue`);
          return;
        }
      } else {
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
        } catch (error) {
          if ((error as AxiosError).response) {
            await flowElement.log(LogLevel.Error, `Error ID: ${(error as AxiosError).response.data.ErrorId} | ${(error as AxiosError).response.data.Reason}`);
          } else {
            await flowElement.log(LogLevel.Error, `Job processing encountered an issue`);
          }
        }

        //send to flow
        try {
          let newJob = await flowElement.createJob(tmpFilePath);
          if (datasetType == "XML") {
            let xmlString = js2xmlparser.parse("eCommerce", eCommerceOrders[i]);
            writeFileSync(tmpDatasetPath, xmlString);
            await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.XML);
          } else if (datasetType == "JSON") {
            writeFileSync(tmpDatasetPath, JSON.stringify(eCommerceOrders[i]));
            await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.JSON);
          }
          await newJob.sendToData(Connection.Level.Success, jobName);
        } catch (error) {
          await flowElement.log(LogLevel.Error, `Job could not be created`);
          return;
        }

        //remove the temp file
        if (existsSync(tmpFilePath)) {
          unlinkSync(tmpFilePath);
        }

        //remove the temp Dataset
        if (existsSync(tmpDatasetPath)) {
          unlinkSync(tmpDatasetPath);
        }
      }
    } else {
      await flowElement.log(LogLevel.Info, `No new eCommerce orders found`);
      return;
    }
  }
}

//main code for webhook
async function flowStartTriggered(s: Switch, flowElement: FlowElement) {
  //get the properties
  let method: string = (await flowElement.getPropertyStringValue("method")) as string;
  if (method == "Polling") {
    //exit the script
    return;
  } else if (method == "Webhook") {
    //get the properties
    let apiKey: string = (await flowElement.getPropertyStringValue("apiKey")) as string;

    //define webhook path
    let webhookPath = "/eCommerce";
    try {
      //subscribe to webhook path
      await s.httpRequestSubscribe(HttpRequest.Method.POST, webhookPath, [apiKey]);
    } catch (error: any) {
      flowElement.failProcess(`Failed to subscribe to the request %1`, error.message);
    }
    await flowElement.log(LogLevel.Info, `Subscription started on /scripting${webhookPath}`);
  }
}

//Sends back the initial response, the response will be different if the uuid already exists in global data.
async function httpRequestTriggeredSync(request: HttpRequest, args: any[], response: HttpResponse, s: Switch) {
  let eCommerceData = request.getBodyAsString();
  let eCommerceParse = JSON.parse(eCommerceData);
  let jobID = eCommerceParse.orderId.toString();

  //store jobID in global data
  let processedIDS: Record<string, any> = {};
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
  } else {
    response.setStatusCode(200);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("api_token", args[0]);
    response.setBody(Buffer.from(JSON.stringify({ result: "success", orderID: jobID, api_token: args[0] })));
    processedIDS[jobID] = { arrival: new Date().getTime(), product: eCommerceParse.product.productName };
    await s.setGlobalData(Scope.FlowElement, "uuids", JSON.stringify(processedIDS));
  }
}

//Processes the request by downloading the production file from the defined url and injecting in the flow while at the same time attaching the product description as a dataset
async function httpRequestTriggeredAsync(request: HttpRequest, args: any[], s: Switch, flowElement: FlowElement) {
  //get the properties
  let datasetType: string = (await flowElement.getPropertyStringValue("datasetType")) as string;
  let datasetName: string = (await flowElement.getPropertyStringValue("datasetName")) as string;

  //define variables
  let tmpFilePath: string = "",
    tmpDatasetPath: string = "",
    metaData: any;

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
  } catch (error) {
    if ((error as AxiosError).response) {
      await flowElement.log(LogLevel.Error, `Error ID: ${(error as AxiosError).response.data.ErrorId} | ${(error as AxiosError).response.data.Reason}`);
    } else {
      await flowElement.log(LogLevel.Error, `Job processing encountered an issue`);
    }
    return;
  }

  //Create job containing the production file and define dataset
  try {
    let newJob = await flowElement.createJob(tmpFilePath);
    if (datasetType == "XML") {
      let xmlString = js2xmlparser.parse("eCommerce", metaData);
      writeFileSync(tmpDatasetPath, xmlString);
      await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.XML);
    } else if (datasetType == "JSON") {
      writeFileSync(tmpDatasetPath, JSON.stringify(metaData));
      await newJob.createDataset(datasetName, tmpDatasetPath, DatasetModel.JSON);
    }
    await newJob.sendToData(Connection.Level.Success, downloadFileName);
  } catch (error) {
    await flowElement.log(LogLevel.Error, `Job could not be created`);
    return;
  }

  //remove the temp file
  if (existsSync(tmpFilePath)) {
    unlinkSync(tmpFilePath);
  }

  //remove the temp Dataset
  if (existsSync(tmpDatasetPath)) {
    unlinkSync(tmpDatasetPath);
  }
}

//get orders
async function getOrders(flowElement: FlowElement, baseURL: string, apiKey: string): Promise<Record<string, any>[]> {
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
  } catch (error) {
    throw error;
  }
}

//download asset
async function downloadFile(flowElement: FlowElement, downloadURL: string): Promise<Record<string, any>> {
  try {
    let result = await axios.default.get(downloadURL, {
      maxBodyLength: Infinity,
      headers: {},
      responseType: "stream",
    });
    return result;
  } catch (error) {
    throw error;
  }
}

//streaming the downloaded translated file to tmpfile
const writeFile = async (data: any, savePath: string) => {
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(savePath);

    data.pipe(writer);
    let error: Error | null = null;
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
