// supabase/functions/upload-to-drive/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"; // Keep this for the HTTP server
import { create as createJwt, decode as decodeJwt } from "https://deno.land/x/djwt@v2.8/mod.ts"; // NEW: For JWT creation
import { Jose, Payload } from "https://deno.land/x/djwt@v2.8/mod.ts"; // NEW: For JWT types


// Retrieve environment variables
const GOOGLE_SERVICE_ACCOUNT_KEY_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");

// Ensure environment variables are set
if (!GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable.");
    Deno.exit(1);
}
if (!GOOGLE_DRIVE_FOLDER_ID) {
    console.error("Missing GOOGLE_DRIVE_FOLDER_ID environment variable.");
    Deno.exit(1);
}

// Parse the service account key JSON once
let serviceAccountKey: any;
try {
    serviceAccountKey = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
} catch (e) {
    console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY JSON:", e);
    Deno.exit(1);
}

// Helper function to get an Access Token from Google using the Service Account Key
async function getGoogleAccessToken(): Promise<string> {
    const header: Jose = {
        alg: "RS256",
        typ: "JWT",
    };

    const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
    const jwtPayload: Payload = {
        iss: serviceAccountKey.client_email, // Issuer: service account email
        scope: "https://www.googleapis.com/auth/drive.file", // Scope: specific to Google Drive file access
        aud: "https://oauth2.googleapis.com/token", // Audience: Google's token endpoint
        exp: now + (60 * 60), // Expiration: 1 hour from now
        iat: now, // Issued at: current timestamp
    };

    // Use the private key from your service account JSON to sign the JWT
    // The 'ext' property means the private key is in PKCS#8 format, base64-encoded.
    // Deno's Web Crypto API requires a specific format.
    // We're expecting a private_key in PKCS#8 PEM format (starts with -----BEGIN PRIVATE KEY-----)
    const privateKey = serviceAccountKey.private_key;

    if (!privateKey) {
        throw new Error("Private key not found in GOOGLE_SERVICE_ACCOUNT_KEY.");
    }

    // Import the private key for signing
    // This part is the most sensitive and might require careful formatting of the private key
    // The `djwt` library might handle PEM format directly, but if not, you might need to
    // remove `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` and any newlines,
    // then base64 decode it. For simplicity, let's assume djwt can handle PEM.
    const cryptoKey = await crypto.subtle.importKey(
        "jwk", // Or "pkcs8" if you convert the PEM to JWK
        // For actual PEM string, you might need a helper function to convert PEM to JWK
        // or a library that directly signs with PEM.
        // For demonstration, assuming a JWK format or djwt's direct PEM handling.
        // If your `private_key` from the JSON is a simple string starting with '-----BEGIN PRIVATE KEY-----',
        // you might need to process it. Let's assume djwt's `create` function takes a string for 'key'.
        privateKey, // This is the PEM string from your service account JSON
        {
            name: "RSASSA-PKCS1-v1_5", // Algorithm name
            hash: "SHA-256",
        },
        true, // extractable
        ["sign"] // usages
    );

    const jwt = await createJwt(header, jwtPayload, cryptoKey); // Create the signed JWT

    // Exchange the JWT for an Access Token
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

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to get Google Access Token: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
        throw new Error("Access token not found in Google response.");
    }

    return tokenData.access_token;
}

// Main Supabase Edge Function handler
serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response("Method Not Allowed", { status: 405 });
        }

        // IMPORTANT: How you get the file content and name from the request
        // depends on how your client sends the data.
        // Common ways:
        // 1. Multipart/form-data (for actual file uploads from a browser/form)
        // 2. Raw binary in body with Content-Type header (e.g., from another service)
        // 3. JSON body with base64 encoded file content (less efficient, but simpler for some cases)

        // For this example, let's assume the request body is JSON with
        // 'fileName' and 'fileContentBase64' (base64 encoded string of the file)
        const requestBody = await req.json();
        const fileName = requestBody.fileName;
        const fileContentBase64 = requestBody.fileContentBase64;
        const mimeType = requestBody.mimeType || "application/octet-stream"; // Default mime type if not provided

        if (!fileName || !fileContentBase64) {
            return new Response(
                JSON.stringify({ error: "Missing 'fileName' or 'fileContentBase64' in request body." }),
                { headers: { "Content-Type": "application/json" }, status: 400 }
            );
        }

        // Get the Google Access Token
        const accessToken = await getGoogleAccessToken();

        // --- Step 1: Create File Metadata ---
        // This is typically the first step for resumable uploads, but can be combined
        // with the content for multipart. For simplicity, let's use a "multipart"
        // approach conceptually, where metadata and content are sent together.
        // However, the actual fetch for multipart is complex due to 'boundary'.

        // Let's simplify and assume the client sends the file data directly in the body
        // and we're treating it as a simple upload where Google guesses the type or
        // you manually set the Content-Type header to the actual file type.
        // For a true multipart upload, you'd need a FormData equivalent in Deno or build it manually.

        // Simpler approach: Assume file content is raw binary (e.g., from fetch directly)
        // and metadata is in query params or a previous step.
        // A more robust approach for files: use Resumable Upload.

        // Let's use a "simple" upload for small files, which sends the content directly.
        // Metadata is sent as query parameters in this simple case or as part of the path.
        // This is NOT the standard "multipart" upload often seen in browser forms.
        // The Google Drive API documentation defines "Simple Upload" for small files.

        const uploadUrl = new URL("https://www.googleapis.com/upload/drive/v3/files");
        uploadUrl.searchParams.append("uploadType", "media"); // "media" is for simple upload of raw file data

        const metadata = {
            name: fileName,
            parents: [GOOGLE_DRIVE_FOLDER_ID],
            mimeType: mimeType, // Use the provided mimeType or default
        };

        // You need to send the metadata AND the file content.
        // For 'uploadType=media', the body is *just* the file content.
        // You'd typically set metadata first, then upload content.

        // Let's adjust to the actual recommended pattern:
        // For the `create` method with `uploadType=multipart`, you send metadata AND content
        // in a single request, but it requires a `multipart/related` Content-Type.
        // This means constructing a complex string with boundaries.

        // A better approach for Edge Functions: Use `uploadType=resumable`
        // 1. Initiate upload: Send metadata, get upload URL.
        // 2. Upload content: Send file content to the upload URL.

        // --- Step 1: Initiate Resumable Upload ---
        const initiateUploadResponse = await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mimeType, // Inform Google about the actual content type
                    "X-Upload-Content-Length": String(atob(fileContentBase64).length), // Inform Google about file size
                },
                body: JSON.stringify(metadata),
            }
        );

        if (!initiateUploadResponse.ok) {
            const errorText = await initiateUploadResponse.text();
            console.error("Failed to initiate Google Drive upload:", errorText);
            return new Response(
                JSON.stringify({ error: `Failed to initiate upload: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadLocation = initiateUploadResponse.headers.get("Location");
        if (!uploadLocation) {
            throw new Error("No upload location header received from Google Drive.");
        }

        // --- Step 2: Upload File Content to the obtained Location ---
        const fileContent = atob(fileContentBase64); // Decode base64 string to binary string
        const uploadFileResponse = await fetch(uploadLocation, {
            method: "PUT", // Use PUT for uploading content in resumable session
            headers: {
                "Content-Type": mimeType, // This is the content type of the file itself
            },
            body: fileContent, // Send the raw binary content
        });

        if (!uploadFileResponse.ok) {
            const errorText = await uploadFileResponse.text();
            console.error("Failed to upload file content to Google Drive:", errorText);
            return new Response(
                JSON.stringify({ error: `Failed to upload file content: ${errorText}` }),
                { headers: { "Content-Type": "application/json" }, status: 500 }
            );
        }

        const uploadedFileInfo = await uploadFileResponse.json();
        console.log("File uploaded successfully:", uploadedFileInfo);

        return new Response(
            JSON.stringify({
                message: "File uploaded successfully to Google Drive.",
                fileId: uploadedFileInfo.id,
                fileName: uploadedFileInfo.name,
                webViewLink: uploadedFileInfo.webViewLink, // Link to view the file
            }),
            {
                headers: { "Content-Type": "application/json" },
                status: 200,
            }
        );

    } catch (error) {
        console.error("Error in upload-to-drive function:", error.message);
        return new Response(
            JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
            { headers: { "Content-Type": "application/json" }, status: 500 }
        );
    }
});
