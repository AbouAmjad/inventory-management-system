// supabase/functions/upload-to-drive/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { create as createJwt, decode as decodeJwt } from "https://deno.land/x/djwt@v2.8/mod.ts";
import { Jose, Payload } from "https://deno.land/x/djwt@v2.8/mod.ts";

const GOOGLE_SERVICE_ACCOUNT_KEY_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

// These checks should now pass if secrets are in Supabase.
// If they still fail, the secrets are NOT correctly configured in Supabase dashboard.
if (!GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    console.error("CRITICAL ERROR: GOOGLE_SERVICE_ACCOUNT_KEY environment variable is missing in Supabase secrets.");
    Deno.exit(1);
}
if (!GOOGLE_DRIVE_FOLDER_ID) {
    console.error("CRITICAL ERROR: GOOGLE_DRIVE_FOLDER_ID environment variable is missing in Supabase secrets.");
    Deno.exit(1);
}

let serviceAccountKey: any;
try {
    serviceAccountKey = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
    console.log("LOG: Service Account Key JSON parsed successfully.");
} catch (e) {
    console.error("CRITICAL ERROR: Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON. Check if it's valid JSON in Supabase secrets.", e);
    Deno.exit(1);
}

// Helper function to convert PEM to ArrayBuffer for crypto.subtle.importKey
function pemToArrayBuffer(pem) {
    const base64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s/g, ''); // Remove all whitespace, including newlines
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}


async function getGoogleAccessToken(): Promise<string> {
    console.log("LOG: Attempting to get Google Access Token...");
    const header: Jose = {
        alg: "RS256",
        typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload: Payload = {
        iss: serviceAccountKey.client_email,
        scope: "https://www.googleapis.com/auth/drive.file", // Or broader "https://www.googleapis.com/auth/drive" if needed
        aud: "https://oauth2.googleapis.com/token",
        exp: now + (60 * 60), // Token valid for 1 hour
        iat: now,
    };

    const privateKeyPem = serviceAccountKey.private_key;
    if (!privateKeyPem) {
        console.error("CRITICAL ERROR: 'private_key' property not found in parsed GOOGLE_SERVICE_ACCOUNT_KEY.");
        throw new Error("Private key not found in GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    let cryptoKey: CryptoKey;
    try {
        console.log("LOG: Converting PEM to ArrayBuffer and importing private key...");
        const privateKeyBuffer = pemToArrayBuffer(privateKeyPem);

        cryptoKey = await crypto.subtle.importKey(
            "pkcs8", // Format for the private key
            privateKeyBuffer,
            {
                name: "RSASSA-PKCS1-v1_5", // Algorithm for signing
                hash: "SHA-256",
            },
            false, // not extractable (should be false for private keys)
            ["sign"] // Usage: for signing JWTs
        );
        console.log("LOG: Private key imported successfully.");
    } catch (e) {
        console.error("CRITICAL ERROR: Failed to import private key. Check PEM format and content:", e);
        throw new Error(`Failed to import private key: ${e.message}`);
    }

    console.log("LOG: Creating JWT...");
    const jwt = await createJwt(header, jwtPayload, cryptoKey);
    console.log("LOG: JWT created.");

    console.log("LOG: Fetching access token from Google OAuth2 endpoint...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
        }).toString(),
    });

    console.log("LOG: Google Token response status:", tokenResponse.status);
    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("CRITICAL ERROR: Google Access Token Error Response:", tokenResponse.status, errorText);
        throw new Error(`Failed to get Google Access Token: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
        console.error("CRITICAL ERROR: Access token not found in Google response data:", tokenData);
        throw new Error("Access token not found in Google response.");
    }
    console.log("LOG: Google Access Token obtained successfully.");
    return tokenData.access_token;
}

serve(async (req) => {
    console.log("LOG: Function invoked. Starting request processing...");
    try {
        if (req.method !== 'POST') {
            console.log("LOG: Method not POST. Returning 405.");
            return new Response("Method Not Allowed", { status: 405 });
        }

        const requestBody = await req.json();
        console.log("LOG: Request body parsed successfully.");

        const fileName = requestBody.fileName;
        const fileContentBase64 = requestBody.fileContentBase64;
        const mimeType = requestBody.mimeType || "application/octet-stream";

        if (!fileName || !fileContentBase64) {
            console.log("LOG: Missing 'fileName' or 'fileContentBase64' in request body.");
            return new Response(
                JSON.stringify({ error: "Missing 'fileName' or 'fileContentBase64' in request body." }),
                { headers: { "Content-Type": "application/json" }, status: 400 }
            );
        }
        console.log(`LOG: Received file: ${fileName} (${mimeType}), ${fileContentBase64.length} chars base64.`);

        const accessToken = await getGoogleAccessToken();
        console.log("LOG: Access token retrieved. Initiating Google Drive upload...");

        // --- Step 1: Initiate Resumable Upload ---
        const initiateUploadResponse = await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mimeType,
                    "X-Upload-Content-Length": String(atob(fileContentBase64).length),
                },
                body: JSON.stringify({
                    name: fileName,
                    parents: [GOOGLE_DRIVE_FOLDER_ID],
                    mimeType: mimeType,
                }),
            }
        );

        console.log("LOG: Initiate upload response status:", initiateUploadResponse.status);
        if (!initiateUploadResponse.ok) {
            const errorText = await initiateUploadResponse.text();
            console.error("CRITICAL ERROR: Google Drive Initiate Upload Error Response:", initiateUploadResponse.status, errorText);
            return new Response(
                JSON.stringify({ error: `Failed to initiate upload: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadLocation = initiateUploadResponse.headers.get("Location");
        if (!uploadLocation) {
            console.error("CRITICAL ERROR: No upload location header received from Google Drive.");
            throw new Error("No upload location header received from Google Drive.");
        }
        console.log("LOG: Upload location obtained:", uploadLocation);

        // --- Step 2: Upload File Content to the obtained Location ---
        const fileContent = atob(fileContentBase64); // Decode base64 string to binary string
        console.log(`LOG: Uploading ${fileContent.length} bytes of file content to Google Drive...`);

        const uploadFileResponse = await fetch(uploadLocation, {
            method: "PUT",
            headers: {
                "Content-Type": mimeType,
            },
            body: fileContent,
        });

        console.log("LOG: Google Drive file upload response status:", uploadFileResponse.status);
        if (!uploadFileResponse.ok) {
            const errorText = await uploadFileResponse.text();
            console.error("CRITICAL ERROR: Google Drive File Upload Content Error Response:", uploadFileResponse.status, errorText);
            return new Response(
                JSON.stringify({ error: `Failed to upload file content: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadedFileInfo = await uploadFileResponse.json();
        console.log("LOG: File uploaded successfully to Google Drive:", uploadedFileInfo);

        return new Response(
            JSON.stringify({
                message: "File uploaded successfully to Google Drive.",
                fileId: uploadedFileInfo.id,
                fileName: uploadedFileInfo.name,
                webViewLink: uploadedFileInfo.webViewLink,
            }),
            {
                headers: { "Content-Type": "application/json" },
                status: 200,
            }
        );

    } catch (error) {
        // This catch block should now log more specific errors if they occur
        console.error("CRITICAL ERROR: Caught unexpected error in upload-to-drive function:", error.message, error.stack);
        return new Response(
            JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
            { headers: { "Content-Type": "application/json" }, status: 500 }
        );
    }
});
