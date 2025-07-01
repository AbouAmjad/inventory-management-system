import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { google } from 'https://deno.land/x/googleapis@v0.11.0/mod.ts';
import * as streamifier from 'https://deno.land/x/streamifier@v0.0.4/mod.ts';


// Initialize Google Auth (Service Account)
const GOOGLE_SERVICE_ACCOUNT_KEY = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID');

if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set.');
    // In a real function, you might want to throw an error or return a 500 response
    // For now, we'll proceed but operations will fail.
}
if (!GOOGLE_DRIVE_FOLDER_ID) {
    console.error('GOOGLE_DRIVE_FOLDER_ID environment variable is not set.');
}

let auth: google.auth.GoogleAuth | null = null;
try {
    // Parse the service account key JSON string
    const serviceAccountInfo = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY!);

    auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: serviceAccountInfo.client_email,
            private_key: serviceAccountInfo.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });

    // Optional: Log successful auth (remove in production for security)
    console.log('GoogleAuth initialized successfully.');

} catch (error) {
    console.error('Error initializing GoogleAuth from service account key:', error);
    auth = null; // Ensure auth is null if initialization fails
}


// Function to parse multipart/form-data
async function parseMultipartFormData(request: Request) {
    const formData = await request.formData();
    const files: { name: string; content: Uint8Array; type: string }[] = [];
    const fields: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
            // Read file content as Uint8Array
            const arrayBuffer = await value.arrayBuffer();
            files.push({
                name: value.name,
                content: new Uint8Array(arrayBuffer),
                type: value.type,
            });
        } else {
            fields[key] = value.toString();
        }
    }
    return { files, fields };
}


serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!auth || !GOOGLE_DRIVE_FOLDER_ID) {
            console.error('Google API not configured or folder ID missing. Cannot process upload.');
            return new Response(JSON.stringify({ error: 'Server configuration error: Google Drive API not ready.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { files } = await parseMultipartFormData(req);

        if (files.length === 0) {
            return new Response(JSON.stringify({ error: 'No file uploaded' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const fileToUpload = files[0]; // Assuming only one file per upload

        const drive = google.drive({ version: 'v3', auth });

        // Create a readable stream from the file content
        const media = {
            mimeType: fileToUpload.type,
            body: streamifier.createReadStream(fileToUpload.content), // Use streamifier to convert Uint8Array to readable stream
        };

        const fileMetadata = {
            name: fileToUpload.name,
            parents: [GOOGLE_DRIVE_FOLDER_ID], // Specify the folder ID
        };

        const res = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink, webContentLink', // Request specific fields in the response
        });

        console.log('File uploaded to Google Drive:', res.data);

        return new Response(JSON.stringify({
            message: 'File uploaded successfully',
            fileId: res.data.id,
            fileName: res.data.name,
            webViewLink: res.data.webViewLink, // URL to view the file in browser
            webContentLink: res.data.webContentLink // URL to download the file
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // IMPORTANT for CORS - adjust for production
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });

    } catch (error) {
        console.error('Error processing request:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // IMPORTANT for CORS - adjust for production
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
});
