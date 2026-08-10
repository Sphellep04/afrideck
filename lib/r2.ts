import { AwsClient } from "aws4fetch";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error(
    "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET environment variables are not set"
  );
}

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

function objectUrl(key: string): string {
  return `${endpoint}/${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await client.fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: { "content-type": contentType },
  });
  if (!res.ok) {
    throw new Error(`R2 put failed for "${key}": ${res.status} ${await res.text()}`);
  }
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const res = await client.fetch(objectUrl(key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 get failed for "${key}": ${res.status} ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export interface R2ListedObject {
  key: string;
  lastModified: string;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function listObjects(prefix: string): Promise<R2ListedObject[]> {
  const url = new URL(`${endpoint}/${bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);

  const res = await client.fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`R2 list failed for prefix "${prefix}": ${res.status} ${await res.text()}`);
  }

  const xml = await res.text();
  const objects: R2ListedObject[] = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let block: RegExpExecArray | null;
  while ((block = contentsRe.exec(xml))) {
    const key = /<Key>(.*?)<\/Key>/.exec(block[1]);
    const lastModified = /<LastModified>(.*?)<\/LastModified>/.exec(block[1]);
    if (key && lastModified) {
      objects.push({ key: unescapeXml(key[1]), lastModified: lastModified[1] });
    }
  }
  return objects;
}
