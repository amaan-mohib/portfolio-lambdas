import {
  APIGatewayProxyEvent,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";
import * as dotenv from "dotenv";

const fetcher = async (input: URL | RequestInfo, options?: RequestInit) =>
  await (await fetch(input, options)).json();

export const handler: Handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResultV2> => {
  try {
    dotenv.config();

    [
      process.env.HOME_FUNCTION_URL,
      process.env.PROJECTS_FUNCTION_URL,
      process.env.LINKS_FUNCTION_URL,
    ].forEach((link) => {
      fetcher(link);
    });

    const response = {
      statusCode: 200,
      body: "ok",
    };
    return response;
  } catch (error) {
    return {
      statusCode: 400,
      body: error,
    };
  }
};
