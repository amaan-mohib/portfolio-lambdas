import { APIGatewayProxyEvent, Handler } from "aws-lambda";
import * as dotenv from "dotenv";

const fetcher = async (input: URL | RequestInfo, options?: RequestInit) =>
  await (await fetch(input, options)).json();

export const handler: Handler = async (
  event: APIGatewayProxyEvent
): Promise<any> => {
  try {
    dotenv.config();

    const res = await Promise.all(
      [
        process.env.HOME_FUNCTION_URL,
        process.env.PROJECTS_FUNCTION_URL,
        process.env.LINKS_FUNCTION_URL,
      ].map((link) => fetcher(link))
    );

    console.log(res);

    const response = {
      statusCode: 200,
      body: res,
    };
    return response;
  } catch (error) {
    return {
      statusCode: 400,
      body: error,
    };
  }
};
