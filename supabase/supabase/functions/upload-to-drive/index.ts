// supabase/functions/upload-to-drive/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { create as createJwt, decode as decodeJwt } from "https://deno.land/x/djwt@v2.8/mod.ts";
import { Jose, Payload } from "https://deno.land/x/djwt@v2.8/mod.ts";

const GOOGLE_SERVICE_ACCOUNT_KEY_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

// Ensure environment variables are set (these checks should now pass if secrets are in Supabase)
if (!GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable. THIS SHOULD NOT HAPPEN NOW.");
    Deno.exit(1);
}
if (!GOOGLE_DRIVE_FOLDER_ID) {
    console.error("Missing GOOGLE_DRIVE_FOLDER_ID environment variable. THIS SHOULD NOT HAPPEN NOW.");
    Deno.exit(1);
}

let serviceAccountKey: any;
try {
    serviceAccountKey = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
    console.log("Service Account Key JSON parsed successfully."); // ADDED LOG
} catch (e) {
    console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON:", e);
    Deno.exit(1);
}

async function getGoogleAccessToken(): Promise<string> {
    console.log("Attempting to get Google Access Token..."); // ADDED LOG
    const header: Jose = {
        alg: "RS256",
        typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload: Payload = {
        iss: serviceAccountKey.client_email,
        scope: "https://www.googleapis.com/auth/drive.file",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + (60 * 60),
        iat: now,
    };

    const privateKey = serviceAccountKey.private_key;
    if (!privateKey) {
        throw new Error("Private key not found in GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    // IMPORTANT: This part is sensitive to the format of the private_key.
    // If you encounter errors here, it's likely due to the PEM format.
    // For now, let's assume djwt handles it.
    let cryptoKey: CryptoKey;
    try {
        // This is a common way to import PEM private keys for RS256 in Deno/Web Crypto.
        // It requires the PEM string to be properly formatted (newlines included).
        const pemHeader = "-----BEGIN PRIVATE KEY-----";
        const pemFooter = "-----END PRIVATE KEY-----";
        const pemContents = privateKey.substring(pemHeader.length, privateKey.length - pemFooter.length).replace(/\n/g, '');
        const binaryDer = atob(pemContents);
        const binaryDerBytes = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            binaryDerBytes[i] = binaryDer.charCodeAt(i);
        }

        cryptoKey = await crypto.subtle.importKey(
            "pkcs8",
            binaryDerBytes,
            {
                name: "RSASSA-PKCS1-v1_5",
                hash: "SHA-256",
            },
            false, // not extractable
            ["sign"]
        );
        console.log("Private key imported successfully."); // ADDED LOG
    } catch (e) {
        console.error("Error importing private key:", e); // ADDED LOG
        throw new Error(`Failed to import private key: ${e.message}`);
    }


    const jwt = await createJwt(header, jwtPayload, cryptoKey);
    console.log("JWT created."); // ADDED LOG

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

    console.log("Token response status:", tokenResponse.status); // ADDED LOG
    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Google Access Token Error Response:", errorText); // ADDED LOG
        throw new Error(`Failed to get Google Access Token: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
        console.error("Access token not found in Google response data:", tokenData); // ADDED LOG
        throw new Error("Access token not found in Google response.");
    }
    console.log("Google Access Token obtained successfully."); // ADDED LOG
    return tokenData.access_token;
}

serve(async (req) => {
    console.log("Function invoked. Parsing request body..."); // ADDED LOG
    try {
        if (req.method !== 'POST') {
            console.log("Method not POST. Returning 405."); // ADDED LOG
            return new Response("Method Not Allowed", { status: 405 });
        }

        const requestBody = await req.json();
        console.log("Request body parsed successfully."); // ADDED LOG

        const fileName = requestBody.fileName;
        const fileContentBase64 = requestBody.fileContentBase64;
        const mimeType = requestBody.mimeType || "application/octet-stream";

        if (!fileName || !fileContentBase64) {
            console.log("Missing fileName or fileContentBase64."); // ADDED LOG
            return new Response(
                JSON.stringify({ error: "Missing 'fileName' or 'fileContentBase64' in request body." }),
                { headers: { "Content-Type": "application/json" }, status: 400 }
            );
        }

        const accessToken = await getGoogleAccessToken();
        console.log("Access token retrieved. Initiating upload..."); // ADDED LOG

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

        console.log("Initiate upload response status:", initiateUploadResponse.status); // ADDED LOG
        if (!initiateUploadResponse.ok) {
            const errorText = await initiateUploadResponse.text();
            console.error("Google Drive Initiate Upload Error Response:", errorText); // ADDED LOG
            return new Response(
                JSON.stringify({ error: `Failed to initiate upload: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadLocation = initiateUploadResponse.headers.get("Location");
        if (!uploadLocation) {
            console.error("No upload location header received."); // ADDED LOG
            throw new Error("No upload location header received from Google Drive.");
        }
        console.log("Upload location obtained:", uploadLocation); // ADDED LOG

        // --- Step 2: Upload File Content to the obtained Location ---
        const fileContent = atob(fileContentBase64);
        console.log(`Uploading ${fileContent.length} bytes of file content...`); // ADDED LOG

        const uploadFileResponse = await fetch(uploadLocation, {
            method: "PUT",
            headers: {
                "Content-Type": mimeType,
            },
            body: fileContent,
        });

        console.log("File upload response status:", uploadFileResponse.status); // ADDED LOG
        if (!uploadFileResponse.ok) {
            const errorText = await uploadFileResponse.text();
            console.error("Google Drive File Upload Content Error Response:", errorText); // ADDED LOG
            return new Response(
                JSON.stringify({ error: `Failed to upload file content: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadedFileInfo = await uploadFileResponse.json();
        console.log("File uploaded successfully to Google Drive:", uploadedFileInfo); // ADDED LOG

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
        console.error("Caught error in upload-to-drive function:", error.message); // ADDED LOG
        return new Response(
            JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
            { headers: { "Content-Type": "application/json" }, status: 500 }
        );
    }
});
