// script.js

// YOUR SUPABASE PROJECT URL AND ANON KEY
const SUPABASE_URL = 'https://vjhikffducpurixlkfjd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqaGlrZmZkdWNwdXJpeGxrZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTExNzIxNTcsImV4cCI6MjA2Njc0ODE1N30.lLlq3LYmHqpG7c5WOgfNFscRLjPDKkWnTkllw_X4Q_Y';

let supabase;
let userId = null; // Stores the UUID of the logged-in user
let userEmail = null; // Stores the email of the logged-in user for display

window.allItems = []; // Global array for item autocompletion (contains {id, name})
let currentInventoryData = []; // Stores the full inventory items data for client-side filtering
let currentTransactionData = []; // Stores the full transaction history data for client-side filtering

// --- Authentication & Initialization ---

/**
 * Initializes the Supabase client and sets up the authentication state listener.
 * This function runs once on page load to determine if a user is already logged in.
 */
async function initializeSupabase() {
    // Basic check if Supabase SDK is loaded (it's loaded via CDN in index.html)
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase SDK not found. Make sure the Supabase CDN script is loaded before script.js.');
        document.getElementById('loggedInUserEmailMobile').textContent = 'Error: Supabase SDK not loaded!';
        document.getElementById('loggedInUserEmailDesktop').textContent = 'Error: Supabase SDK not loaded!';
        return;
    }

    // Basic check for placeholder Supabase credentials
    if (SUPABASE_URL.includes('YOUR_SUPABASE_URL') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY')) {
        console.error('Supabase URL or Anon Key not set in script.js!');
        document.getElementById('loggedInUserEmailMobile').textContent = 'ERROR: Set Supabase URL/Key!';
        document.getElementById('loggedInUserEmailDesktop').textContent = 'ERROR: Set Supabase URL/Key!';
        return;
    }

    // Create the Supabase client instance
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Set up a listener for authentication state changes. This is the core logic
    // that determines whether to show the login screen or the main app.
    supabase.auth.onAuthStateChange((event, session) => {
        console.log('Auth event:', event, 'Session:', session);
        if (session && session.user) {
            // User is logged in
            userId = session.user.id;
            userEmail = session.user.email; // Get the user's email for display
            
            // Update email display for both mobile and desktop user info bars
            const emailMobileElement = document.getElementById('loggedInUserEmailMobile');
            const emailDesktopElement = document.getElementById('loggedInUserEmailDesktop');
            if (emailMobileElement) emailMobileElement.textContent = `Logged in as: ${userEmail}`;
            if (emailDesktopElement) emailDesktopElement.textContent = `Logged in as: ${userEmail}`;

            showAppScreen(); // Transition to the main application interface
            setupRealtimeListeners(); // Set up all real-time data listeners for the logged-in user
        } else {
            // User is logged out or no active session
            userId = null;
            userEmail = null;
            showAuthScreen(); // Transition to the authentication screen
            // Clear all data and UI related to the previous user/session
            currentInventoryData = [];
            window.allItems = [];
            renderInventoryTable([]); // Clear inventory table display
            currentTransactionData = [];
            renderTransactionTable([]); // Clear transaction table display
            supabase.removeAllChannels(); // Disconnect any active real-time subscriptions
        }
    });

    // Check for an initial active session on page load.
    // The `onAuthStateChange` listener above usually handles this, but this
    // explicit check can ensure immediate UI correctness.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error("Error getting initial session:", error.message);
        showAuthScreen(); // Default to auth screen if there's an error fetching session
    } else if (session) {
        console.log("Initial session found. onAuthStateChange will handle transition.");
        // The onAuthStateChange callback will be triggered immediately with this session.
    } else {
        console.log("No active session found. Showing authentication screen.");
        showAuthScreen(); // No session, so show the login screen
    }
}

/**
 * Shows the authentication screen and hides the main application screen.
 */
function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
}

/**
 * Shows the main application screen and hides the authentication screen.
 * Also defaults to the 'Add New Item' tab upon showing.
 */
function showAppScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    // Ensure only the first content tab is visible and its sidebar button is active
    const allAppTabs = document.querySelectorAll("#appScreen .app-tab-content");
    allAppTabs.forEach(tab => tab.style.display = "none"); // Hide all app content tabs first

    const sidebarButtons = document.querySelectorAll(".sidebar-button");
    sidebarButtons.forEach(button => button.classList.remove("active")); // Deactivate all sidebar buttons

    // Explicitly show the first tab ('Add New Item') and activate its corresponding button
    const firstTabContent = document.getElementById('addItemTab');
    const firstSidebarButton = document.querySelector('.sidebar-button');

    if (firstTabContent) {
        firstTabContent.style.display = "block";
    }
    if (firstSidebarButton) {
        firstSidebarButton.classList.add("active");
    }

    // Also trigger initial data fetches for critical tables when the app screen loads
    fetchInventoryAndRender();
    fetchTransactionHistoryAndRender();
}

/**
 * Sets up all necessary real-time listeners for the application's data.
 * Called once a user is successfully logged in.
 */
function setupRealtimeListeners() {
    if (!supabase || !userId) {
        console.warn("Supabase client or user ID not ready for real-time listeners. Skipping setup.");
        return;
    }

    // Always remove all channels first to prevent multiple subscriptions if this is called multiple times
    // (e.g., if the user logs out and logs back in without a full page refresh).
    supabase.removeAllChannels();

    // 1. Real-time Listener for 'products' table (for Inventory View updates)
    // This listener is critical for real-time stock updates.
    supabase
        .channel('public:products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `user_id=eq.${userId}` }, payload => {
            console.log('Real-time product change received!', payload);
            fetchInventoryAndRender(); // Re-fetch and re-render the inventory
            fetchTransactionHistoryAndRender(); // Also refresh transaction history as product changes might affect it
        })
        .subscribe();

    // 2. Real-time Listener for 'incoming_transactions' table (for Transaction History updates)
    supabase
        .channel('public:incoming_transactions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_transactions', filter: `user_id=eq.${userId}` }, payload => {
            console.log('Real-time incoming transaction change received!', payload);
            fetchTransactionHistoryAndRender(); // Re-fetch and re-render transaction history
        })
        .subscribe();

    // 3. Real-time Listener for 'outgoing_transactions' table (for Transaction History updates)
    supabase
        .channel('public:outgoing_transactions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_transactions', filter: `user_id=eq.${userId}` }, payload => {
            console.log('Real-time outgoing transaction change received!', payload);
            fetchTransactionHistoryAndRender(); // Re-fetch and re-render transaction history
        })
        .subscribe();

    // Initial fetches and renders for all relevant data when listeners are set up
    // These are already called by showAppScreen, but kept here for robustness
    // in case setupRealtimeListeners is called independently.
    fetchInventoryAndRender();
    fetchTransactionHistoryAndRender();
}

/**
 * Fetches inventory data from Supabase for the current user and renders it into the table.
 * This also updates the global `window.allItems` for autocomplete and `currentInventoryData` for filtering.
 */
async function fetchInventoryAndRender() {
    if (!supabase || !userId) {
        console.warn("Supabase client or user ID not ready to fetch inventory.");
        return;
    }

    console.log(`Attempting to fetch inventory for user: ${userId}`);
    const { data, error } = await supabase
        .from('products')
        .select('*') // Select all columns, including current_stock
        .eq('user_id', userId)
        .order('item_name', { ascending: true });

    if (error) {
        console.error('Error fetching inventory:', error.message);
        document.getElementById('inventoryEmptyState').textContent = `Error loading inventory: ${error.message}. Please ensure 'products' table exists and RLS is configured correctly.`;
        document.getElementById('inventoryEmptyState').classList.remove('hidden');
    } else {
        console.log("Inventory data fetched successfully:", data);
        currentInventoryData = data; // Store the full fetched data
        // Update the global list for item autocompletion
        window.allItems = data.map(item => ({ id: item.item_id, name: item.item_name }));
        filterInventoryTable(); // Render/filter the table with the new data
        console.log("Inventory data rendered.");
    }
}

/**
 * Renders the provided array of inventory items into the HTML table.
 * @param {Array<Object>} items - An array of inventory item objects to display.
 */
function renderInventoryTable(items) {
    const tableBody = document.getElementById('inventoryTableBody');
    const emptyState = document.getElementById('inventoryEmptyState');
    tableBody.innerHTML = ''; // Clear existing table rows

    if (items.length === 0) {
        emptyState.classList.remove('hidden');
        emptyState.textContent = 'No items in inventory. Add a new item to get started!';
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    items.forEach(item => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = item.item_id || 'N/A';
        row.insertCell().textContent = item.item_name || 'N/A';
        row.insertCell().textContent = item.description || '';
        row.insertCell().textContent = `$${(parseFloat(item.unit_cost) || 0).toFixed(2)}`;
        row.insertCell().textContent = `$${(parseFloat(item.selling_price) || 0).toFixed(2)}`;
        // Ensure current_stock is displayed correctly, even if it's 0 or null
        row.insertCell().textContent = item.current_stock !== null && item.current_stock !== undefined ? item.current_stock : '0';
    });
}

/**
 * Filters the displayed inventory table based on the search input value.
 * This performs client-side filtering on the `currentInventoryData`.
 */
function filterInventoryTable() {
    const searchTerm = document.getElementById('inventorySearch').value.toLowerCase();
    const filteredItems = currentInventoryData.filter(item =>
        item.item_id.toLowerCase().includes(searchTerm) ||
        item.item_name.toLowerCase().includes(searchTerm) ||
        (item.description && item.description.toLowerCase().includes(searchTerm))
    );
    renderInventoryTable(filteredItems); // Re-render the table with filtered results
}

/**
 * Fetches all incoming and outgoing transactions for the current user,
 * combines them, sorts by date, and renders them into the Transaction History table.
 */
async function fetchTransactionHistoryAndRender() {
    if (!supabase || !userId) {
        console.warn("Supabase client or user ID not ready to fetch transactions.");
        return;
    }

    console.log(`Attempting to fetch transactions for user: ${userId}`);

    // Fetch incoming transactions
    const { data: incomingData, error: incomingError } = await supabase
        .from('incoming_transactions')
        .select('*')
        .eq('user_id', userId);

    if (incomingError) {
        console.error('Error fetching incoming transactions:', incomingError.message);
        document.getElementById('transactionEmptyState').textContent = `Error loading incoming transactions: ${incomingError.message}`;
        document.getElementById('transactionEmptyState').classList.remove('hidden');
        return;
    }
    console.log("Incoming data:", incomingData);

    // Fetch outgoing transactions
    const { data: outgoingData, error: outgoingError } = await supabase
        .from('outgoing_transactions')
        .select('*')
        .eq('user_id', userId);

    if (outgoingError) {
        console.error('Error fetching outgoing transactions:', outgoingError.message);
        document.getElementById('transactionEmptyState').textContent = `Error loading outgoing transactions: ${outgoingError.message}`;
        document.getElementById('transactionEmptyState').classList.remove('hidden');
        return;
    }
    console.log("Outgoing data:", outgoingData);


    // Combine and format transactions
    let combinedTransactions = [];

    incomingData.forEach(tx => {
        combinedTransactions.push({
            type: 'Incoming',
            itemId: tx.item_id,
            quantity: tx.quantity,
            contact: tx.supplier || 'N/A',
            // Display Delivery Note / PO Number clearly
            refNo: `DN: ${tx.delivery_note || 'N/A'} / PO: ${tx.po_number || 'N/A'}`,
            notes: tx.notes || '',
            createdAt: tx.created_at
        });
    });

    outgoingData.forEach(tx => {
        combinedTransactions.push({
            type: 'Outgoing',
            itemId: tx.item_id,
            quantity: tx.quantity,
            contact: tx.customer || 'N/A',
            refNo: 'N/A', // Outgoing transactions don't have DN/PO numbers by default
            notes: tx.notes || '',
            createdAt: tx.created_at
        });
    });

    // Sort transactions by creation date (most recent first)
    combinedTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    currentTransactionData = combinedTransactions; // Store for client-side filtering
    filterTransactionTable(); // Render/filter the transaction table with the new data
    console.log("Transaction history fetched and rendered.");
}

/**
 * Renders the provided array of transactions into the HTML transaction history table.
 * @param {Array<Object>} transactions - An array of transaction objects to display.
 */
function renderTransactionTable(transactions) {
    const tableBody = document.getElementById('transactionTableBody');
    const emptyState = document.getElementById('transactionEmptyState');
    tableBody.innerHTML = ''; // Clear existing table rows

    if (transactions.length === 0) {
        emptyState.classList.remove('hidden');
        emptyState.textContent = 'No transactions found.';
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    transactions.forEach(tx => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = new Date(tx.createdAt).toLocaleString(); // Format date nicely
        row.insertCell().textContent = tx.type;
        row.insertCell().textContent = tx.itemId;
        row.insertCell().textContent = tx.quantity;
        row.insertCell().textContent = tx.contact;
        row.insertCell().textContent = tx.refNo;
        row.insertCell().textContent = tx.notes;
    });
}

/**
 * Filters the currently displayed transaction table based on search input.
 * This function uses `currentTransactionData` for client-side filtering.
 */
function filterTransactionTable() {
    const searchTerm = document.getElementById('transactionSearch').value.toLowerCase();
    const filteredTransactions = currentTransactionData.filter(tx =>
        (tx.itemId && tx.itemId.toLowerCase().includes(searchTerm)) ||
        (tx.contact && tx.contact.toLowerCase().includes(searchTerm)) ||
        (tx.refNo && tx.refNo.toLowerCase().includes(searchTerm)) ||
        (tx.notes && tx.notes.toLowerCase().includes(searchTerm)) ||
        (tx.type && tx.type.toLowerCase().includes(searchTerm))
    );
    renderTransactionTable(filteredTransactions);
}


// --- UI Helper Functions (for tab switching, messages, loading states) ---

/**
 * Switches between authentication tabs (currently only Sign In).
 * @param {Event} evt - The event object from the click.
 * @param {string} tabName - The ID of the tab content element to show.
 */
function showAuthTab(evt, tabName) {
    // Hide all tab content within the authentication screen
    const tabcontent = document.querySelectorAll("#authScreen .tab-content");
    tabcontent.forEach(el => el.style.display = "none");

    // Deactivate all tab buttons within the authentication screen
    const tabbuttons = document.querySelectorAll("#authScreen .tab-button");
    tabbuttons.forEach(el => el.classList.remove("active"));

    // Show the selected tab content and activate its button
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
}

/**
 * Switches between main application tabs (now controlled by sidebar buttons).
 * @param {Event} evt - The event object from the click.
 * @param {string} tabName - The ID of the tab content element to show.
 */
function openAppTab(evt, tabName) {
    // Hide all tab content within the main application screen
    const tabcontent = document.querySelectorAll("#appScreen .app-tab-content");
    tabcontent.forEach(el => el.style.display = "none");

    // Deactivate all sidebar buttons
    const sidebarbuttons = document.querySelectorAll(".sidebar-button");
    sidebarbuttons.forEach(el => el.classList.remove("active"));

    // Show the selected tab content and activate its button
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");

    // Re-trigger data fetch/filter if switching to inventory or history tab
    if (tabName === 'viewInventoryTab') {
        filterInventoryTable(); // Refresh inventory display
    } else if (tabName === 'transactionHistoryTab') {
        filterTransactionTable(); // Refresh transaction history display
    }
}


/**
 * Displays a message in a designated message box.
 * @param {string} messageBoxId - The ID of the div element to display the message in.
 * @param {string} message - The text message to display.
 * @param {boolean} isSuccess - True for a success message (green styling), false for an error (red styling).
 */
function showMessage(messageBoxId, message, isSuccess) {
    const messageBox = document.getElementById(messageBoxId);
    messageBox.textContent = message;
    messageBox.classList.remove('hidden', 'message-success', 'message-error');
    if (isSuccess) {
        messageBox.classList.add('message-success');
    } else {
        messageBox.classList.add('message-error');
    }
}

/**
 * Hides a message box.
 * @param {string} messageBoxId - The ID of the div element to hide.
 */
function hideMessage(messageBoxId) {
    document.getElementById(messageBoxId).classList.add('hidden');
}

/**
 * Disables a button and shows a loading spinner to indicate ongoing processing.
 * @param {string} buttonId - The ID of the button to disable.
 */
function showLoading(buttonId) {
    const button = document.getElementById(buttonId);
    button.disabled = true;
    button.innerHTML = 'Processing... <span class="loading-spinner"></span>';
}

/**
 * Enables a button and restores its original text after processing is complete.
 * @param {string} buttonId - The ID of the button to enable.
 * @param {string} originalText - The original text content of the button.
 */
function hideLoading(buttonId, originalText) {
    const button = document.getElementById(buttonId);
    button.disabled = false;
    button.textContent = originalText;
}

// --- Authentication Forms Submission Handlers ---

// Event listener for the login form submission
document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    hideMessage('loginMessage');
    showLoading('loginBtn');

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    hideLoading('loginBtn', 'Sign In');
    if (error) {
        console.error('Login error:', error.message);
        showMessage('loginMessage', `Login error: ${error.message}`, false);
    } else {
        showMessage('loginMessage', 'Logged in successfully!', true);
        this.reset();
        // The `onAuthStateChange` listener will handle showing the app screen.
    }
});

// Event listener for the unified logout buttons (mobile and desktop)
document.getElementById('logoutBtnUnified').addEventListener('click', async function() {
    await handleLogout();
});
document.getElementById('logoutBtnUnifiedDesktop').addEventListener('click', async function() {
    await handleLogout();
});

async function handleLogout() {
    // Show loading state on both logout buttons
    showLoading('logoutBtnUnified');
    showLoading('logoutBtnUnifiedDesktop');

    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Logout error:', error.message);
        alert(`Logout failed: ${error.message}`); // Using alert here for simplicity, consider a custom modal in production
    } else {
        console.log('Logged out successfully');
        // The `onAuthStateChange` listener will handle showing the auth screen.
    }
    // Hide loading state on both buttons
    hideLoading('logoutBtnUnified', 'Logout');
    hideLoading('logoutBtnUnifiedDesktop', 'Logout');
}


// --- Application Forms Submission Handlers (Add, Incoming, Outgoing) ---

// Add Item Form submission
document.getElementById('addItemForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    hideMessage('addItemMessage');
    showLoading('addItemBtn');

    if (!supabase || !userId) {
        showMessage('addItemMessage', 'Authentication required to add items.', false);
        hideLoading('addItemBtn', 'Add Item');
        return;
    }

    const formData = new FormData(this);
    const itemData = { user_id: userId, current_stock: 0 };
    for (const [key, value] of formData.entries()) {
        itemData[key] = value.trim();
    }
    itemData.unit_cost = parseFloat(itemData.unit_cost) || 0;
    itemData.selling_price = parseFloat(itemData.selling_price) || 0;

    const { data: existingItems, error: fetchError } = await supabase
        .from('products')
        .select('item_id')
        .eq('user_id', userId)
        .eq('item_id', itemData.item_id);

    if (fetchError) {
        showMessage('addItemMessage', `Error checking item ID: ${fetchError.message}`, false);
        hideLoading('addItemBtn', 'Add Item');
        return;
    }

    if (existingItems && existingItems.length > 0) {
        showMessage('addItemMessage', `Error: Item with ID '${itemData.item_id}' already exists for your inventory.`, false);
        hideLoading('addItemBtn', 'Add Item');
        return;
    }

    const { error } = await supabase
        .from('products')
        .insert([itemData]);

    if (error) {
        console.error("Error adding item:", error);
        showMessage('addItemMessage', `Error adding item: ${error.message}`, false);
    } else {
        showMessage('addItemMessage', `Item '${itemData.item_name}' added successfully!`, true);
        this.reset();
    }
    hideLoading('addItemBtn', 'Add Item');
});

// Incoming Form submission
document.getElementById('incomingForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    hideMessage('incomingMessage');
    showLoading('incomingBtn');

    if (!supabase || !userId) {
        showMessage('incomingMessage', 'Authentication required to record incoming stock.', false);
        hideLoading('incomingBtn', 'Record Incoming');
        return;
    }

    const formData = new FormData(this);
    const transactionData = { user_id: userId };
    for (const [key, value] of formData.entries()) {
        transactionData[key] = value.trim();
    }
    transactionData.quantity = parseInt(transactionData.quantity) || 0;

    if (isNaN(transactionData.quantity) || transactionData.quantity <= 0) {
        showMessage('incomingMessage', "Quantity must be a positive number.", false);
        hideLoading('incomingBtn', 'Record Incoming');
        return;
    }

    // Step 1: Find the product and its current stock
    const { data: products, error: fetchProductError } = await supabase
        .from('products')
        .select('id, current_stock')
        .eq('user_id', userId)
        .eq('item_id', transactionData.item_id);

    if (fetchProductError) {
        showMessage('incomingMessage', `Error finding item: ${fetchProductError.message}`, false);
        hideLoading('incomingBtn', 'Record Incoming');
        return;
    }
    if (!products || products.length === 0) {
        showMessage('incomingMessage', `Error: Item ID '${transactionData.item_id}' not found in your inventory.`, false);
        hideLoading('incomingBtn', 'Record Incoming');
        return;
    }

    const product = products[0];
    const newStock = (product.current_stock || 0) + transactionData.quantity;

    // Step 2: Record the incoming transaction in `incoming_transactions` table
    const { error: insertError } = await supabase
        .from('incoming_transactions')
        .insert([transactionData]);

    if (insertError) {
        console.error("Error recording incoming transaction:", insertError);
        showMessage('incomingMessage', `Error recording incoming: ${insertError.message}`, false);
        hideLoading('incomingBtn', 'Record Incoming');
        return;
    }

    // Step 3: Update the product's current stock in the `products` table
    const { error: updateError } = await supabase
        .from('products')
        .update({ current_stock: newStock })
        .eq('id', product.id)
        .eq('user_id', userId);

    if (updateError) {
        console.error("Error updating stock:", updateError);
        showMessage('incomingMessage', `Error updating stock: ${updateError.message}`, false);
    } else {
        showMessage('incomingMessage', `Incoming stock for '${transactionData.item_id}' recorded successfully!`, true);
        this.reset();
        document.getElementById('incomingAutocompleteList').innerHTML = '';
        document.getElementById('incomingAutocompleteList').classList.add('hidden');
    }
    hideLoading('incomingBtn', 'Record Incoming');
});

// Outgoing Form submission
document.getElementById('outgoingForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    hideMessage('outgoingMessage');
    showLoading('outgoingBtn');

    if (!supabase || !userId) {
        showMessage('outgoingMessage', 'Authentication required to record outgoing stock.', false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }

    const formData = new FormData(this);
    const transactionData = { user_id: userId };
    for (const [key, value] of formData.entries()) {
        transactionData[key] = value.trim();
    }
    transactionData.quantity = parseInt(transactionData.quantity) || 0;

    if (isNaN(transactionData.quantity) || transactionData.quantity <= 0) {
        showMessage('outgoingMessage', "Quantity must be a positive number.", false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }

    // Step 1: Find the product and its current stock
    const { data: products, error: fetchProductError } = await supabase
        .from('products')
        .select('id, current_stock')
        .eq('user_id', userId)
        .eq('item_id', transactionData.item_id);

    if (fetchProductError) {
        showMessage('outgoingMessage', `Error finding item: ${fetchProductError.message}`, false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }
    if (!products || products.length === 0) {
        showMessage('outgoingMessage', `Error: Item ID '${transactionData.item_id}' not found in your inventory.`, false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }

    const product = products[0];
    const currentStock = product.current_stock || 0;

    if (currentStock < transactionData.quantity) {
        showMessage('outgoingMessage', `Error: Insufficient stock for '${transactionData.item_id}'. Current stock: ${currentStock}, Requested: ${transactionData.quantity}.`, false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }

    const newStock = currentStock - transactionData.quantity;

    // Step 2: Record the outgoing transaction in `outgoing_transactions` table
    const { error: insertError } = await supabase
        .from('outgoing_transactions')
        .insert([transactionData]);

    if (insertError) {
        console.error("Error recording outgoing transaction:", insertError);
        showMessage('outgoingMessage', `Error recording outgoing: ${insertError.message}`, false);
        hideLoading('outgoingBtn', 'Record Outgoing');
        return;
    }

    // Step 3: Update the product's current stock in the `products` table
    const { error: updateError } = await supabase
        .from('products')
        .update({ current_stock: newStock })
        .eq('id', product.id)
        .eq('user_id', userId);

    if (updateError) {
        console.error("Error updating stock:", updateError);
        showMessage('outgoingMessage', `Error updating stock: ${updateError.message}`, false);
    } else {
        showMessage('outgoingMessage', `Outgoing stock for '${transactionData.item_id}' recorded successfully!`, true);
        this.reset();
        document.getElementById('outgoingAutocompleteList').innerHTML = '';
        document.getElementById('outgoingAutocompleteList').classList.add('hidden');
    }
    hideLoading('outgoingBtn', 'Record Outgoing');
});


// --- Autocomplete Logic ---
let currentFocus = -1;

/**
 * Filters items based on user input for autocomplete functionality in input fields.
 * @param {HTMLInputElement} inputElement - The input field where the user is typing.
 * @param {string} listId - The ID of the HTML element (div) that will display the autocomplete list.
 */
function filterItems(inputElement, listId) {
    const inputValue = inputElement.value.toLowerCase();
    const autocompleteList = document.getElementById(listId);
    autocompleteList.innerHTML = '';
    autocompleteList.classList.remove('hidden');
    currentFocus = -1;

    if (!inputValue) {
        autocompleteList.classList.add('hidden');
        return;
    }

    const filteredItems = window.allItems.filter(item =>
        item.id.toLowerCase().includes(inputValue) ||
        item.name.toLowerCase().includes(inputValue)
    );

    if (filteredItems.length === 0) {
        autocompleteList.classList.add('hidden');
        return;
    }

    filteredItems.slice(0, 10).forEach((item, index) => {
        const div = document.createElement('div');
        div.classList.add('autocomplete-list-item');
        div.innerHTML = `${highlightMatch(item.id, inputValue)} - ${highlightMatch(item.name, inputValue)}`;
        div.dataset.itemId = item.id;

        div.addEventListener('click', function() {
            inputElement.value = this.dataset.itemId;
            autocompleteList.classList.add('hidden');
            inputElement.focus();
        });
        autocompleteList.appendChild(div);
    });
}

/**
 * Helper function to highlight the matching portion of a string.
 * @param {string} text - The full text string.
 * @param {string} match - The substring to highlight.
 * @returns {string} HTML string with the matched part wrapped in <strong> tags.
 */
function highlightMatch(text, match) {
    const index = text.toLowerCase().indexOf(match);
    if (index > -1) {
        return text.substring(0, index) +
               '<strong>' + text.substring(index, index + match.length) + '</strong>' +
               text.substring(index + match.length);
    }
    return text;
}

// Global event listener for keyboard navigation (ArrowUp, ArrowDown, Enter) in autocomplete lists
document.addEventListener('keydown', function(e) {
    let autocompleteList;
    let inputElement;

    if (document.getElementById('incomingTab').style.display !== 'none') {
        autocompleteList = document.getElementById('incomingAutocompleteList');
        inputElement = document.getElementById('incomingItemId');
    } else if (document.getElementById('outgoingTab').style.display !== 'none') {
        autocompleteList = document.getElementById('outgoingAutocompleteList');
        inputElement = document.getElementById('outgoingItemId');
    } else {
        return;
    }

    if (autocompleteList.classList.contains('hidden')) return;

    const items = autocompleteList.querySelectorAll('.autocomplete-list-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        currentFocus = (currentFocus + 1) % items.length;
        setActiveItem(items, currentFocus);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        currentFocus = (currentFocus - 1 + items.length) % items.length;
        setActiveItem(items, currentFocus);
    } else if (e.key === 'Enter') {
        if (currentFocus > -1) {
            e.preventDefault();
            items[currentFocus].click();
        }
    }
});

/**
 * Sets the active (highlighted) item in an autocomplete list for keyboard navigation.
 * @param {NodeList} items - A NodeList of all autocomplete list item elements.
 * @param {number} index - The index of the item to activate.
 */
function setActiveItem(items, index) {
    items.forEach((item, i) => {
        item.classList.remove('selected');
    });
    if (index > -1 && index < items.length) {
        items[index].classList.add('selected');
        items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}


// Hide autocomplete list when clicking anywhere outside its container
document.addEventListener('click', function(event) {
    if (!event.target.closest('.autocomplete-container')) {
        document.getElementById('incomingAutocompleteList').classList.add('hidden');
        document.getElementById('outgoingAutocompleteList').classList.add('hidden');
    }
});

// Initial setup on page load: Initialize Supabase.
document.addEventListener('DOMContentLoaded', () => {
    initializeSupabase();
});
