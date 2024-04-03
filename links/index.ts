import {
  APIGatewayProxyEvent,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";
import * as dotenv from "dotenv";
import { Client } from "@notionhq/client";
import { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const fetcher = async (input: URL | RequestInfo, options?: RequestInit) =>
  await (await fetch(input, options)).json();

export const handler: Handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResultV2> => {
  dotenv.config();

  try {
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET!,
      },
      region: process.env.S3_REGION!,
    });
    const notion = new Client({
      auth: process.env.NOTION_TOKEN,
      notionVersion: "2022-06-28",
    });
    const linkPage = await notion.blocks.children.list({
      block_id: process.env.LINKS_PAGE_ID!,
      page_size: 100,
    });

    const linksUrl: string[] = [];

    linkPage.results.forEach((result: BlockObjectResponse) => {
      if (result.type === "bookmark" && result.bookmark.url) {
        linksUrl.push(result.bookmark.url);
      }
    });

    const apiData = await Promise.all(
      linksUrl.map((link) => fetcher(`${process.env.LINK_PREVIEW_URL}${link}`))
    );

    const links = apiData.map((data) => {
      return {
        title: data.title,
        description: data.description,
        image: data.image,
        url: data.url,
      };
    });

    const linksJsonCommand = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: "links.json",
      Body: Buffer.from(JSON.stringify(links)),
      ContentType: "application/json",
      ContentDisposition: "inline",
    });

    await s3Client.send(linksJsonCommand);
  } catch (error) {
    return {
      statusCode: 400,
      body: error,
    };
  }
  const response = {
    statusCode: 200,
    body: "ok",
  };
  return response;
};
