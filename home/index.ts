import {
  APIGatewayProxyEvent,
  APIGatewayProxyResultV2,
  Handler,
} from "aws-lambda";
import * as dotenv from "dotenv";
import { Client } from "@notionhq/client";
import {
  BlockObjectResponse,
  DatabaseObjectResponse,
  RichTextItemResponse,
  TextRichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface IProject {
  github_url: string;
  url: string;
  name: string;
  description: string;
  languages: { name: string; color: string }[];
  image: string;
  fallbackName: string;
  slug: string;
}

const getHTMLTagsFromAnnotations = (
  annotations: TextRichTextItemResponse["annotations"],
  link: string | null,
  keepLink = true
) => {
  let closingTag = "",
    openingTag = "";
  Object.keys(annotations).forEach((tag) => {
    if (annotations[tag] === false) return;
    switch (tag) {
      case "bold":
        openingTag += "<b>";
        closingTag += "</b>";
        break;
      case "italic":
        openingTag += "<i>";
        closingTag += "</i>";
        break;
      case "strikethrough":
        openingTag += "<s>";
        closingTag += "</s>";
        break;
      case "underline":
        openingTag += "<u>";
        closingTag += "</u>";
        break;
      case "code":
        openingTag += "<code>";
        closingTag += "</code>";
        break;
    }
  });
  if (link && keepLink) {
    openingTag += `<a href="${link}">`;
    closingTag += "</a>";
  }
  return {
    openingTag,
    closingTag,
  };
};

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
    const aboutPage = await notion.blocks.children.list({
      block_id: process.env.ABOUT_PAGE_ID!,
      page_size: 100,
    });
    const informationTable = await notion.databases.query({
      database_id: process.env.INFORMATION_TABLE_ID!,
      page_size: 1,
      sorts: [
        {
          property: "Is Latest",
          direction: "descending",
        },
      ],
    });
    const projectsTable = await notion.databases.query({
      database_id: process.env.PROJECTS_TABLE_ID!,
      page_size: 3,
      sorts: [
        {
          property: "Priority",
          direction: "ascending",
        },
        {
          property: "Language length",
          direction: "descending",
        },
        {
          property: "Name",
          direction: "ascending",
        },
      ],
    });

    const infoTitleKeyMap = {
      Name: "name",
      Designation: "designation",
      "Profile picture": "profilePicture",
      Resume: "resume",
    };
    const projectTitleKeyMap = {
      "GitHub URL": "github_url",
      Image: "image",
      Name: "name",
      Description: "description",
      Languages: "languages",
      URL: "url",
      "Fallback name": "fallbackName",
      Slug: "slug",
    };
    const info = {
      description: "",
      name: "",
      designation: "",
      profilePicture: "",
      resume: "",
    };

    let description = "";
    aboutPage.results.forEach((result: BlockObjectResponse) => {
      if (
        result.type === "paragraph" &&
        result.paragraph.rich_text.length > 0
      ) {
        result.paragraph.rich_text.forEach((text) => {
          const { closingTag, openingTag } = getHTMLTagsFromAnnotations(
            text.annotations,
            text.href
          );
          description += `${openingTag}${text.plain_text}${closingTag}`;
        });
      }
    });

    info.description = description;

    informationTable.results.forEach((result: DatabaseObjectResponse) => {
      Object.entries(result.properties).forEach(([key, entry]) => {
        if (!(key in infoTitleKeyMap)) return;
        let value = "";
        if (entry.type === "rich_text") {
          (entry.rich_text as unknown as RichTextItemResponse[]).forEach(
            (text) => {
              const { closingTag, openingTag } = getHTMLTagsFromAnnotations(
                text.annotations,
                text.href
              );
              value += `${openingTag}${text.plain_text}${closingTag}`;
            }
          );
        } else if (entry.type === "url") {
          value = entry.url as unknown as string;
        } else if (entry.type === "title") {
          (entry.title as unknown as RichTextItemResponse[]).forEach((text) => {
            const { closingTag, openingTag } = getHTMLTagsFromAnnotations(
              text.annotations,
              text.href
            );
            value += `${openingTag}${text.plain_text}${closingTag}`;
          });
        }
        info[infoTitleKeyMap[key]] = value;
      });
    });

    const projects: IProject[] = [];
    projectsTable.results.forEach((result: DatabaseObjectResponse) => {
      const project: IProject = {
        name: "",
        description: "",
        github_url: "",
        image: "",
        languages: [],
        url: "",
        fallbackName: "",
        slug: "",
      };
      Object.entries(result.properties).forEach(([key, entry]) => {
        if (!(key in projectTitleKeyMap)) return;
        let value: string | any[] = "";
        if (entry.type === "rich_text") {
          (entry.rich_text as unknown as RichTextItemResponse[]).forEach(
            (text) => {
              const { closingTag, openingTag } = getHTMLTagsFromAnnotations(
                text.annotations,
                text.href
              );
              value += `${openingTag}${text.plain_text}${closingTag}`;
            }
          );
        } else if (entry.type === "url") {
          value = entry.url as unknown as string;
        } else if (entry.type === "title") {
          (entry.title as unknown as RichTextItemResponse[]).forEach((text) => {
            const { closingTag, openingTag } = getHTMLTagsFromAnnotations(
              text.annotations,
              text.href,
              false
            );
            value += `${openingTag}${text.plain_text}${closingTag}`;
          });
        } else if (entry.type === "multi_select") {
          value = [];
          (entry.multi_select as unknown as any[]).forEach((el) => {
            (value as any[]).push({
              name: el.name,
              color: el.color,
            });
          });
        }
        project[projectTitleKeyMap[key]] = value;
      });
      projects.push(project);
    });

    const homeJsonCommand = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: "home.json",
      Body: Buffer.from(JSON.stringify({ info, projects })),
      ContentType: "application/json",
      ContentDisposition: "inline",
    });
    const infoJsonCommand = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: "info.json",
      Body: Buffer.from(JSON.stringify(info)),
      ContentType: "application/json",
      ContentDisposition: "inline",
    });

    await Promise.all([
      s3Client.send(homeJsonCommand),
      s3Client.send(infoJsonCommand),
    ]);
  } catch (error) {
    return {
      statusCode: 400,
      body: error,
    };
  }

  return {
    statusCode: 200,
    body: "ok",
  };
};
