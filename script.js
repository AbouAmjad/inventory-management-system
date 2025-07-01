// script.js

// IMPORTANT: Replace with your actual Supabase project URL and Anon Key
const SUPABASE_URL = 'https://vjhikffducpurixlkfjd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqaGlrZmZkdWNwdXJpeGxrZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTExNzIxNTcsImV4cCI6MjA2Njc0ODE1N30.lLlq3LYmHqpG7c5WOgfNFscRLjPDKkWnTkllw_X4Q_Y';

// Ensure Supabase URL and Key are provided
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    alert("CRITICAL ERROR: Supabase URL or Anon Key is missing. Please check your script.js file.");
    console.error("Supabase URL or Key not set. Please update script.js.");
}

// --- Supabase Client Initialization ---
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Get DOM Elements ---
const itemForm = document.getElementById('itemForm');
const itemNameInput = document.getElementById('itemName');
const itemImageInput = document.getElementById('itemImage');
const dnPdfInput = document.getElementById('dnPdf');
const invoicePdfInput = document.getElementById('invoicePdf');
const messageElement = document.getElementById('message');
const uploadedImagePreview = document.getElementById('uploadedImagePreview');
const pdfLinksContainer = document.getElementById('pdfLinksContainer'); // Assuming you updated index.html to have this container

// --- Helper function to read a file and convert it to Base64 ---
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]); // Get only the base64 part
        reader.onerror = error => reject(error);
    });
}

// --- Function to Upload File to Google Drive via Supabase Edge Function (Now sends JSON with Base64) ---
async function uploadFileToDrive(file, fileTypeLabel) {
    if (!file) {
        // If no file is selected, return a success status indicating it was skipped.
        // This prevents errors for optional file inputs.
        return { success: true, message: `${fileTypeLabel} skipped (no file selected).` };
    }

    messageElement.textContent = `Uploading ${fileTypeLabel} (${file.name})...`;

    try {
        const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/upload-to-drive`;

        // Read file content as Base64
        const fileContentBase64 = await readFileAsBase64(file);

        // Construct the JSON payload expected by your Edge Function
        const payload = {
            fileName: file.name,
            fileContentBase64: fileContentBase64,
            mimeType: file.type // Get the file's MIME type (e.g., 'image/png', 'application/pdf')
        };

        console.log(`Sending ${fileTypeLabel} payload for: ${file.name}`);

        const response = await fetch(edgeFunctionUrl, {
            method: 'POST', // Explicitly set to POST
            headers: {
                'Content-Type': 'application/json', // Crucial: Tell the server we're sending JSON
                // If your Supabase function requires an Authorization header (e.g., API Key or JWT), add it here:
                // 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(payload), // Convert JavaScript object to JSON string
        });

        if (!response.ok) {
            // Attempt to parse error data from response, if available
            const errorData = await response.json().catch(() => ({ error: 'Unknown error, could not parse response.' }));
            throw new Error(`Upload failed for ${fileTypeLabel} (${file.name}): ${response.status} - ${errorData.error || response.statusText}`);
        }

        const data = await response.json();
        messageElement.textContent = `Uploaded ${fileTypeLabel} (${file.name}) successfully.`;
        console.log(`Uploaded ${file.name}:`, data);
        return { success: true, data: data }; // Return the full data, including webViewLink

    } catch (error) {
        console.error(`Error uploading ${fileTypeLabel} (${file.name}):`, error);
        messageElement.textContent = `Error uploading ${fileTypeLabel} (${file.name}): ${error.message}`;
        return { success: false, message: `Error uploading ${fileTypeLabel} (${file.name}): ${error.message}` };
    }
}

// --- Event Listener for Form Submission ---
itemForm.addEventListener('submit', async (event) => {
    event.preventDefault(); // Prevent default browser form submission

    const itemName = itemNameInput.value.trim();
    const itemImageFile = itemImageInput.files[0];
    const dnPdfFile = dnPdfInput.files[0];
    const invoicePdfFile = invoicePdfInput.files[0];

    if (!itemName) {
        messageElement.textContent = 'Please enter an Item Name.';
        return;
    }

    messageElement.textContent = 'Processing item and documents...';
    itemForm.querySelector('button[type="submit"]').disabled = true; // Disable submit button

    // Clear previous previews and links
    uploadedImagePreview.style.display = 'none';
    uploadedImagePreview.src = '';
    pdfLinksContainer.innerHTML = ''; // Clear previous PDF links

    let allUploadsSuccessful = true;
    const uploadResults = [];

    // Upload Item Image
    const itemImageResult = await uploadFileToDrive(itemImageFile, "Item Image");
    uploadResults.push(itemImageResult);
    if (!itemImageResult.success) {
        allUploadsSuccessful = false;
    } else if (itemImageResult.data && itemImageResult.data.webViewLink) {
        uploadedImagePreview.src = itemImageResult.data.webViewLink;
        uploadedImagePreview.style.display = 'block';
    }

    // Upload Delivery Note PDF
    const dnPdfResult = await uploadFileToDrive(dnPdfFile, "Delivery Note PDF");
    uploadResults.push(dnPdfResult);
    if (!dnPdfResult.success) {
        allUploadsSuccessful = false;
    } else if (dnPdfResult.data && dnPdfResult.data.webViewLink) {
        const link = document.createElement('a');
        link.href = dnPdfResult.data.webViewLink;
        link.target = '_blank';
        link.textContent = `View Delivery Note: ${dnPdfFile.name}`;
        link.classList.add('block', 'text-blue-600', 'underline', 'font-bold', 'mt-2');
        pdfLinksContainer.appendChild(link);
    }

    // Upload Invoice PDF
    const invoicePdfResult = await uploadFileToDrive(invoicePdfFile, "Invoice PDF");
    uploadResults.push(invoicePdfResult);
    if (!invoicePdfResult.success) {
        allUploadsSuccessful = false;
    } else if (invoicePdfResult.data && invoicePdfResult.data.webViewLink) {
        const link = document.createElement('a');
        link.href = invoicePdfResult.data.webViewLink;
        link.target = '_blank';
        link.textContent = `View Invoice: ${invoicePdfFile.name}`;
        link.classList.add('block', 'text-blue-600', 'underline', 'font-bold', 'mt-2');
        pdfLinksContainer.appendChild(link);
    }

    // --- Now, save item details and Google Drive URLs to your Supabase database ---
    try {
        // Prepare data for 'items' table
        const itemDataToInsert = {
            name: itemName,
            image_url: itemImageResult.data ? itemImageResult.data.webViewLink : null // Store the Google Drive URL if uploaded
            // Add other item columns here like 'opening_qty', 'received_qty', etc.
        };

        const { data: itemInsertData, error: itemInsertError } = await supabase
            .from('items') // Make sure 'items' is the correct table name in your Supabase project
            .insert([itemDataToInsert])
            .select(); // Use .select() to return the data of the newly inserted row(s)

        if (itemInsertError) throw itemInsertError;
        console.log('Item inserted into Supabase:', itemInsertData);

        // Get the ID of the newly inserted item to link it to receipts
        const newItemId = itemInsertData[0]?.id; // Assuming your 'items' table has an 'id' column

        // If there are any PDFs, insert them into a 'receipts' table, linking to the item
        if (dnPdfResult.data || invoicePdfResult.data) {
            const receiptDataToInsert = {
                item_id: newItemId, // Link to the item created above
                delivery_note_pdf_url: dnPdfResult.data ? dnPdfResult.data.webViewLink : null,
                invoice_pdf_url: invoicePdfResult.data ? invoicePdfResult.data.webViewLink : null,
                receipt_date: new Date().toISOString() // Add a date for the receipt
                // Add other receipt details like 'quantity_received'
            };

            const { data: receiptInsertData, error: receiptInsertError } = await supabase
                .from('receipts') // Make sure 'receipts' is the correct table name
                .insert([receiptDataToInsert])
                .select();

            if (receiptInsertError) throw receiptInsertError;
            console.log('Receipt details inserted into Supabase:', receiptInsertData);
        }

        // Display overall result
        if (allUploadsSuccessful) {
            showMessage("All selected documents processed and data saved successfully!", 'success');
            itemForm.reset(); // Clear the form fields on full success
            // Clear previews after successful submission and form reset
            uploadedImagePreview.style.display = 'none';
            uploadedImagePreview.src = '';
            pdfLinksContainer.innerHTML = '';
        } else {
            // Show messages for individual failures from uploadFileToDrive
            const uploadErrorMessages = uploadResults.filter(r => !r.success).map(r => r.message).join('\n');
            showMessage(`Some uploads failed:\n${uploadErrorMessages}`, 'error');
        }

    } catch (error) {
        console.error('Error saving data to Supabase:', error);
        showMessage(`Failed to save data to Supabase: ${error.message}`, 'error');
        allUploadsSuccessful = false; // Mark overall as failed if DB save fails
    } finally {
        itemForm.querySelector('button[type="submit"]').disabled = false; // Re-enable submit button
    }
});
