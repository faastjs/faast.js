// import { SQS } from "aws-sdk";
// import { log } from "../log";

// type Attributes = { [key: string]: string };

// function hasAttributes(message: SQS.Message, attrs: Attributes) {
//     const a = message.MessageAttributes;
//     if (!a) {
//         return false;
//     }
//     for (const key of Object.keys(attrs)) {
//         if (!a[key] || a[key].StringValue !== attrs[key]) {
//             return false;
//         }
//     }
//     return true;
// }

// function createMessage(QueueUrl: string, attrs: Attributes): SQS.SendMessageRequest {
//     const attributes: SQS.MessageBodyAttributeMap = {};
//     Object.keys(attrs).forEach(key => {
//         attributes[key] = { DataType: "String", StringValue: attrs[key] };
//     });
//     return {
//         QueueUrl,
//         MessageBody: "empty",
//         MessageAttributes: {
//             ...attributes
//         }
//     };
// }

// export function isQueueStopMessage(message: SQS.Message) {
//     return hasAttributes(message, { cloudify: "stop" });
// }

// export function isFunctionStartedMessage(message: SQS.Message) {
//     return hasAttributes(message, { cloudify: "started" });
// }
