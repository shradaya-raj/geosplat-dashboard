import { getAppGraphToken } from "./auth.js";

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
}

async function main() {
  const token = await getAppGraphToken();
  const claims = decodeJwtPayload(token);

  console.log("Graph app token acquired.");
  console.log("Safe token claims:");
  console.log(JSON.stringify({
    aud: claims.aud,
    appid: claims.appid,
    tid: claims.tid,
    roles: claims.roles || [],
    scp: claims.scp || null,
    iss: claims.iss,
    exp: claims.exp
  }, null, 2));

  if (!claims.roles?.length) {
    console.log("");
    console.log("No application roles found in token. Add Microsoft Graph Application permission Files.ReadWrite.All and grant admin consent.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
