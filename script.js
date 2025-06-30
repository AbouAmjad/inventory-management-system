// script.js

// IMPORTANT: Replace with your actual Supabase project URL and Anon Key
const SUPABASE_URL = 'https://vjhikffducpurixlkfjd.supabase.co'; // e.g., https://abcde12345.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqaGlrZmZkdWNwdXJpeGxrZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTExNzIxNTcsImV4cCI6MjA2Njc0ODE1N30.lLlq3LYmHqpG7c5WOgfNFscRLjPDKkWnTkllw_X4Q_Y'; // from Supabase project settings -> API -> Project API Keys -> anon (public)

// Ensure Supabase URL and Key are provided
if (!SUPABASE_URL || SUPABASE_URL === 'https://vjhikffducpurixlkfjd.supabase.co' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqaGlrZmZkdWNwdXJpeGxrZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTExNzIxNTcsImV4cCI6MjA2Njc0ODE1N30.lLlq3LYmHqpG7c5WOgfNFscRLjPDKkWnTkllw_X4Q_Y') {
    alert("CRITICAL ERROR: Please update script.js with your actual SUPABASE_URL and SUPABASE_ANON_KEY.");
    console.error("Supabase URL or Key not set. Please update script.js.");
}

// --- Supabase Client Initialization ---
// You need to include the Supabase client library in your project.
// For local testing, you can use a CDN, but for a real project, install it with npm/yarn.
// Since this is a simple setup, we'll try to import from CDN for quick testing.
// Note: The 'type="module"' in index.html allows this import.
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
const uploadedPdfLink = document.getElementById('uploadedPdfLink');

// --- Function to Upload File to Google Drive via Supabase Edge Function ---
async function uploadFileToDrive(file) {
    if (!file) return null;

    messageElement.textContent = `Uploading ${file.name}...`;
    const formData = new FormData();
    formData.append('file', file); // 'file' matches the name expected by your Edge Function

    try {
        const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/upload-to-drive`;

        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            body: formData,
            // Supabase Edge Functions don't require Authorization header for public access,
            // but if you add authentication to your function later, you'd add:
            // headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Upload failed for ${file.name}: ${errorData.error || response.statusText}`);
        }

        const data = await response.json();
        messageElement.textContent = `Uploaded ${file.name} successfully.`;
        console.log(`Uploaded ${file.name}:`, data);
        return data.webViewLink; // Return the shareable Google Drive link

    } catch (error) {
        console.error('Error uploading file:', error);
        messageElement.textContent = `Error uploading ${file.name}: ${error.message}`;
        return null;
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

    messageElement.textContent = 'Processing files and data...';
    uploadedImagePreview.style.display = 'none';
    uploadedPdfLink.style.display = 'none';

    let itemImageUrl = null;
    let dnPdfUrl = null;
    let invoicePdfUrl = null;

    // Upload Item Image
    if (itemImageFile) {
        itemImageUrl = await uploadFileToDrive(itemImageFile);
        if (!itemImageUrl) {
            // Error already handled by uploadFileToDrive
            return;
        }
    }

    // Upload Delivery Note PDF
    if (dnPdfFile) {
        dnPdfUrl = await uploadFileToDrive(dnPdfFile);
        if (!dnPdfUrl) {
            return;
        }
    }

    // Upload Invoice PDF
    if (invoicePdfFile) {
        invoicePdfUrl = await uploadFileToDrive(invoicePdfFile);
        if (!invoicePdfUrl) {
            return;
        }
    }

    // --- Now, save item details and Google Drive URLs to your Supabase database ---
    try {
        // First, insert the new item into your 'items' table
        const { data: itemInsertData, error: itemInsertError } = await supabase
            .from('items') // Make sure 'items' is the correct table name in your Supabase project
            .insert([
                {
                    name: itemName,
                    image_url: itemImageUrl // Store the Google Drive URL
                    // Add other item columns here like 'opening_qty', 'received_qty', etc.
                }
            ])
            .select(); // Use .select() to return the data of the newly inserted row(s)

        if (itemInsertError) throw itemInsertError;
        console.log('Item inserted into Supabase:', itemInsertData);

        // Get the ID of the newly inserted item to link it to receipts
        const newItemId = itemInsertData[0]?.id; // Assuming your 'items' table has an 'id' column

        // If there are any PDFs, insert them into a 'receipts' table, linking to the item
        if (dnPdfUrl || invoicePdfUrl) {
            const { data: receiptInsertData, error: receiptInsertError } = await supabase
                .from('receipts') // Make sure 'receipts' is the correct table name
                .insert([
                    {
                        item_id: newItemId, // Link to the item created above
                        delivery_note_pdf_url: dnPdfUrl,
                        invoice_pdf_url: invoicePdfUrl,
                        receipt_date: new Date().toISOString() // Add a date for the receipt
                        // Add other receipt details like 'quantity_received'
                    }
                ])
                .select();

            if (receiptInsertError) throw receiptInsertError;
            console.log('Receipt details inserted into Supabase:', receiptInsertData);
        }

        messageElement.textContent = 'Item and documents successfully added to inventory!';
        itemForm.reset(); // Clear the form fields

        // Display previews/links if files were uploaded
        if (itemImageUrl) {
            uploadedImagePreview.src = itemImageUrl;
            uploadedImagePreview.style.display = 'block';
        }
        if (dnPdfUrl) {
            uploadedPdfLink.href = dnPdfUrl;
            uploadedPdfLink.textContent = `View Delivery Note (${dnPdfFile.name})`;
            uploadedPdfLink.style.display = 'block';
        } else if (invoicePdfUrl) {
            uploadedPdfLink.href = invoicePdfUrl;
            uploadedPdfLink.textContent = `View Invoice (${invoicePdfFile.name})`;
            uploadedPdfLink.style.display = 'block';
        }

    } catch (error) {
        console.error('Error saving data to Supabase:', error);
        messageElement.textContent = `Failed to save data: ${error.message}`;
    }
});
