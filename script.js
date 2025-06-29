// script.js

// Supabase Client SDK (will be loaded by index.html)
// Ensure this script is placed AFTER the Supabase CDN script in index.html,
// or that you handle modular imports if you're bundling.
// For this setup, we assume the global `window.supabase` is available.

// YOUR SUPABASE PROJECT URL AND ANON KEY
const SUPABASE_URL = 'https://vjhikffducpurixlkfjd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqaGlrZmZkdWNwdXJpeGxrZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTExNzIxNTcsImV4cCI6MjA2Njc0ODE1N30.lLlq3LYmHqpG7c5WOgfNFscRLjPDKkWnTkllw_X4Q_Y';

let supabase;
let userId = null; // Will be set after successful login
window.allItems = []; // Global array for autocomplete items
let currentInventoryData = []; // Store the full inventory data for client-side filtering

// --- Authentication & Initialization ---

/**
 * Initializes the Supabase client and sets up the authentication state listener.
 */
async function initializeSupabase() {
    // Check if the Supabase client is available (from the CDN script loaded in index.html)
    if (typeof window.supabase === 'undefined') {
        document.getElementById('loggedInUserEmail').textContent = 'ERROR: Supabase SDK not loaded. Check script.js and index.html.';
        console.error('Supabase SDK not found. Make sure the Supabase CDN script is loaded before script.js.');
        return;
    }

    // Basic check for placeholder values in case they were not replaced
    if (SUPABASE_URL.includes('YOUR_SUPABASE_URL') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY')) {
        document.getElementById('loggedInUserEmail').textContent = 'ERROR: Please set Supabase URL/Key in script.js!';
        return;
    }

    // Create Supabase client instance
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Set up a listener for authentication state changes. This is the primary way
    // the app reacts to a user logging in or out.
    supabase.auth.onAuthStateChange((event, session) => {
        console.log('Auth event:', event, 'Session:', session);
        if (session) {
            // User is logged in
            userId = session.user.id;
            document.getElementById('loggedInUserEmail').textContent = `Logged in as: ${session.user.email}`;
            showAppScreen(); // Show the main application interface
            setupRealtimeInventoryListener(); // Set up real-time data listener for this user
        } else {
            // User is logged out or no session
            userId = null;
            showAuthScreen(); // Show the authentication screen
            // Clear all data and UI related to the previous user
            currentInventoryData = [];
            window.allItems = [];
            renderInventoryTable([]); // Clear the inventory table
            supabase.removeAllChannels(); // Disconnect any active real-time subscriptions
        }
    });

    // On initial page load, check if there's an active session.
    // The onAuthStateChange listener usually handles this, but an explicit
    // getSession call ensures the UI state is correct immediately.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error("Error getting initial session:", error.message);
        showAuthScreen(); // If there's an error getting session, show auth screen
    } else if (session) {
        // If a session exists, onAuthStateChange will be triggered,
        // which will set `userId` and call `showAppScreen()`.
        console.log("Initial session found. onAuthStateChange will handle.");
    } else {
        // No active session, so explicitly show the authentication screen.
        console.log("No active session found. Showing authentication screen.");
        showAuthScreen();
    }

    // Always ensure the Sign In tab is active initially on the auth screen.
    document.querySelector('#authScreen .tab-button').click();
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
 * Also defaults to the 'Add New Item' tab.
 */
function showAppScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    // Default to the first app tab ('Add New Item') when the app screen is shown
    document.querySelector('#appScreen .tab-button').click();
}

// --- Supabase Data Interactions ---

/**
 * Sets up a real-time listener for the 'products' table.
 * This listener automatically updates the inventory display when data changes
 * for the currently logged-in user.
 */
function setupRealtimeInventoryListener() {
    // Guard clause: ensure supabase client and userId are available
    if (!supabase || !userId) {
        console.warn("Supabase client or user ID not ready for inventory listener. Skipping listener setup.");
        return;
    }

    // Remove any existing real-time subscriptions to prevent duplicate listeners,
    // especially important when a user logs in after being logged out.
    supabase.removeAllChannels();

    // Subscribe to changes specifically for the 'products' table where 'user_id' matches the current user.
    // This leverages RLS directly in the real-time subscription.
    supabase
        .channel('public:products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `user_id=eq.${userId}` }, payload => {
            console.log('Real-time change received:', payload);
            fetchInventoryAndRender(); // Re-fetch and re-render the inventory
        })
        .subscribe(); // Activate the subscription

    // Perform an initial fetch and render when the listener is set up.
    fetchInventoryAndRender();
}

/**
 * Fetches inventory data from the 'products' table for the current user
 * and then triggers the rendering of the inventory table.
 */
async function fetchInventoryAndRender() {
    // Guard clause: ensure supabase client and userId are available
    if (!supabase || !userId) {
        console.warn("Supabase client or user ID not ready to fetch inventory.");
        return;
    }

    // Fetch data from the 'products' table, filtering by the current user's ID
    // and ordering by item name for a consistent display.
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', userId)
        .order('item_name', { ascending: true });

    if (error) {
        console.error('Error fetching inventory:', error.message);
        // Display an error message if fetching fails
        document.getElementById('inventoryEmptyState').textContent = `Error loading inventory: ${error.message}`;
        document.getElementById('inventoryEmptyState').classList.remove('hidden');
    } else {
        currentInventoryData = data; // Store the full fetched data for client-side filtering
        // Update the global list used for item autocompletion in other forms
        window.allItems = data.map(item => ({ id: item.item_id, name: item.item_name }));
        filterInventoryTable(); // Render/filter the table with the new data
        console.log("Inventory data fetched and rendered.");
    }
}

/**
 * Renders the provided array of inventory items into the HTML table.
 * @param {Array<Object>} items - An array of inventory item objects to display.
 */
function renderInventoryTable(items) {
    const tableBody = document.getElementById('inventoryTableBody');
    const emptyState = document.getElementById('inventoryEmptyState');
    tableBody.innerHTML = ''; // Clear any existing table rows

    if (items.length === 0) {
        // Show empty state message if no items are provided
        emptyState.classList.remove('hidden');
        emptyState.textContent = 'No items in inventory. Add a new item to get started!';
        return;
    } else {
        // Hide empty state if items are present
        emptyState.classList.add('hidden');
    }

    // Populate the table with each item's details
    items.forEach(item => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = item.item_id || 'N/A';
        row.insertCell().textContent = item.item_name || 'N/A';
        row.insertCell().textContent = item.description || '';
        row.insertCell().textContent = `$${(parseFloat(item.unit_cost) || 0).toFixed(2)}`;
        row.insertCell().textContent = `$${(parseFloat(item.selling_price) || 0).toFixed(2)}`;
        row.insertCell().textContent = item.current_stock !== undefined ? item.current_stock : 'N/A';
    });
}

/**
 * Filters the displayed inventory table based on the search input value.
 * This performs client-side filtering on the `currentInventoryData`.
 */
function filterInventoryTable() {
    const searchTerm = document.getElementById('inventorySearch').value.toLowerCase();
    // Filter items where item ID, item name, or description includes the search term
    const filteredItems = currentInventoryData.filter(item =>
        item.item_id.toLowerCase().includes(searchTerm) ||
        item.item_name.toLowerCase().includes(searchTerm) ||
        (item.description && item.description.toLowerCase().includes(searchTerm))
    );
    renderInventoryTable(filteredItems); // Re-render the table with filtered results
}


// --- UI Helper Functions (for tab switching, messages, loading states) ---

/**
 * Switches between authentication tabs (Sign In / Sign Up forms).
 * @param {Event} evt - The event object from the click.
 * @param {string} tabName - The ID of the tab content element to show.
 */
function showAuthTab(evt, tabName) {
    let i, tabcontent, tabbuttons;

    // Hide all tab content within the authentication screen
    tabcontent = document.querySelectorAll("#authScreen .tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Deactivate all tab buttons within the authentication screen
    tabbuttons = document.querySelectorAll("#authScreen .tab-button");
    for (i = 0; i < tabbuttons.length; i++) {
        tabbuttons[i].classList.remove("active");
    }

    // Show the selected tab content and activate its button
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
}

/**
 * Switches between main application tabs (Add Item, Incoming, Outgoing, View Inventory).
 * @param {Event} evt - The event object from the click.
 * @param {string} tabName - The ID of the tab content element to show.
 */
function openAppTab(evt, tabName) {
    let i, tabcontent, tabbuttons;

    // Hide all tab content within the main application screen
    tabcontent = document.querySelectorAll("#appScreen .tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Deactivate all tab buttons within the main application screen
    tabbuttons = document.querySelectorAll("#appScreen .tab-button");
    for (i = 0; i < tabbuttons.length; i++) {
        tabbuttons[i].classList.remove("active");
    }

    // Show the selected tab content and activate its button
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
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
    // Remove previous styling classes and add the appropriate one
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
    button.disabled = true; // Disable the button to prevent multiple clicks
    // Change button text and add a loading spinner
    button.innerHTML = 'Processing... <span class="loading-spinner"></span>';
}

/**
 * Enables a button and restores its original text after processing is complete.
 * @param {string} buttonId - The ID of the button to enable.
 * @param {string} originalText - The original text content of the button.
 */
function hideLoading(buttonId, originalText) {
    const button = document.getElementById(buttonId);
    button.disabled = false; // Enable the button
    button.textContent = originalText; // Restore original text
}

// --- Authentication Forms Submission Handlers ---

// Event listener for the registration form submission
document.getElementById('registerForm').addEventListener('submit', async function(event) {
    event.preventDefault(); // Prevent default form submission
    hideMessage('registerMessage'); // Clear any previous messages
    showLoading('registerBtn'); // Show loading state on button

    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;

    // Basic password confirmation validation
    if (password !== confirmPassword) {
        showMessage('registerMessage', 'Passwords do not match.', false);
        hideLoading('registerBtn', 'Sign Up');
        return;
    }

    // Call Supabase `signUp` method
    const { error } = await supabase.auth.signUp({ email, password });

    hideLoading('registerBtn', 'Sign Up'); // Hide loading state
    if (error) {
        console.error('Sign up error:', error.message);
        showMessage('registerMessage', `Sign up error: ${error.message}`, false);
    } else {
        showMessage('registerMessage', 'Sign up successful! Please sign in.', true);
        this.reset(); // Clear the form fields
        // After successful registration, automatically switch to the Sign In tab
        document.querySelector('#authScreen #signInForm').style.display = "block";
        document.querySelector('#authScreen #signUpForm').style.display = "none";
        document.querySelector('#authScreen .tab-button:nth-child(2)').classList.remove("active");
        document.querySelector('#authScreen .tab-button:nth-child(1)').classList.add("active");
    }
});

// Event listener for the login form submission
document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault(); // Prevent default form submission
    hideMessage('loginMessage'); // Clear any previous messages
    showLoading('loginBtn'); // Show loading state on button

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    // Call Supabase `signInWithPassword` method
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    hideLoading('loginBtn', 'Sign In'); // Hide loading state
    if (error) {
        console.error('Login error:', error.message);
        showMessage('loginMessage', `Login error: ${error.message}`, false);
    } else {
        showMessage('loginMessage', 'Logged in successfully!', true);
        this.reset(); // Clear the form fields
        // The `onAuthStateChange` listener will detect the successful login
        // and transition to the `appScreen`.
    }
});

// Event listener for the logout button
document.getElementById('logoutBtn').addEventListener('click', async function() {
    showLoading('logoutBtn'); // Show loading state on button
    // Call Supabase `signOut` method
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Logout error:', error.message);
        // Display error within the user info bar
        showMessage('loggedInUserEmail', `Logout failed: ${error.message}`, false);
    } else {
        console.log('Logged out successfully');
        // The `onAuthStateChange` listener will detect the logout
        // and transition back to the `authScreen`.
    }
    hideLoading('logoutBtn', 'Logout'); // Hide loading state
});


// --- Application Forms Submission Handlers (Add, Incoming, Outgoing) ---

// Add Item Form submission
document.getElementById('addItemForm').addEventListener('submit', async function(event) {
    event.preventDefault();
    hideMessage('addItemMessage');
    showLoading('addItemBtn');

    // Ensure user is authenticated before proceeding
    if (!supabase || !userId) {
        showMessage('addItemMessage', 'Authentication required to add items.', false);
        hideLoading('addItemBtn', 'Add Item');
        return;
    }

    const formData = new FormData(this);
    const itemData = { user_id: userId, current_stock: 0 }; // Initialize with user_id and 0 stock
    for (const [key, value] of formData.entries()) {
        itemData[key] = value.trim();
    }
    itemData.unit_cost = parseFloat(itemData.unit_cost) || 0;
    itemData.selling_price = parseFloat(itemData.selling_price) || 0;

    // Check for duplicate item_id for the current user to maintain uniqueness
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

    // Insert the new item into the 'products' table
    const { error } = await supabase
        .from('products')
        .insert([itemData]);

    if (error) {
        console.error("Error adding item:", error);
        showMessage('addItemMessage', `Error adding item: ${error.message}`, false);
    } else {
        showMessage('addItemMessage', `Item '${itemData.item_name}' added successfully!`, true);
        this.reset(); // Clear the form
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
        .insert([transactionData]); // This now includes delivery_note and po_number

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
        .eq('user_id', userId); // Ensure RLS is respected for update

    if (updateError) {
        console.error("Error updating stock:", updateError);
        showMessage('incomingMessage', `Error updating stock: ${updateError.message}`, false);
    } else {
        showMessage('incomingMessage', `Incoming stock for '${transactionData.item_id}' recorded successfully!`, true);
        this.reset(); // Clear the form
        document.getElementById('incomingAutocompleteList').innerHTML = ''; // Clear autocomplete
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

    // Check if sufficient stock is available for outgoing transaction
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
        .eq('user_id', userId); // Ensure RLS is respected for update

    if (updateError) {
        console.error("Error updating stock:", updateError);
        showMessage('outgoingMessage', `Error updating stock: ${updateError.message}`, false);
    } else {
        showMessage('outgoingMessage', `Outgoing stock for '${transactionData.item_id}' recorded successfully!`, true);
        this.reset(); // Clear the form
        document.getElementById('outgoingAutocompleteList').innerHTML = ''; // Clear autocomplete
        document.getElementById('outgoingAutocompleteList').classList.add('hidden');
    }
    hideLoading('outgoingBtn', 'Record Outgoing');
});


// --- Autocomplete Logic ---
let currentFocus = -1; // To track currently focused item in autocomplete list

/**
 * Filters items based on user input for autocomplete functionality in input fields.
 * @param {HTMLInputElement} inputElement - The input field where the user is typing.
 * @param {string} listId - The ID of the HTML element (div) that will display the autocomplete list.
 */
function filterItems(inputElement, listId) {
    const inputValue = inputElement.value.toLowerCase();
    const autocompleteList = document.getElementById(listId);
    autocompleteList.innerHTML = ''; // Clear previous suggestions
    autocompleteList.classList.remove('hidden'); // Ensure the list is visible
    currentFocus = -1; // Reset keyboard navigation focus

    // Hide list if input is empty
    if (!inputValue) {
        autocompleteList.classList.add('hidden');
        return;
    }

    // Filter items from the global 'allItems' array (fetched from Supabase)
    const filteredItems = window.allItems.filter(item =>
        item.id.toLowerCase().includes(inputValue) ||
        item.name.toLowerCase().includes(inputValue)
    );

    // Hide list if no matching items are found
    if (filteredItems.length === 0) {
        autocompleteList.classList.add('hidden');
        return;
    }

    // Populate the autocomplete list with up to 10 suggestions
    filteredItems.slice(0, 10).forEach((item, index) => {
        const div = document.createElement('div');
        div.classList.add('autocomplete-list-item');
        // Highlight matching parts of the item ID and name
        div.innerHTML = `${highlightMatch(item.id, inputValue)} - ${highlightMatch(item.name, inputValue)}`;
        div.dataset.itemId = item.id; // Store the full item ID as a data attribute

        // Add click event listener to select an item from the list
        div.addEventListener('click', function() {
            inputElement.value = this.dataset.itemId; // Set input value to selected item ID
            autocompleteList.classList.add('hidden'); // Hide the list
            inputElement.focus(); // Keep focus on the input field
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
        // Construct string with <strong> tags around the matched part
        return text.substring(0, index) +
               '<strong>' + text.substring(index, index + match.length) + '</strong>' +
               text.substring(index + match.length);
    }
    return text; // Return original text if no match
}

// Global event listener for keyboard navigation (ArrowUp, ArrowDown, Enter) in autocomplete lists
document.addEventListener('keydown', function(e) {
    let autocompleteList;
    let inputElement;

    // Determine which autocomplete list is currently active based on tab visibility
    if (document.getElementById('incomingTab').style.display !== 'none') {
        autocompleteList = document.getElementById('incomingAutocompleteList');
        inputElement = document.getElementById('incomingItemId');
    } else if (document.getElementById('outgoingTab').style.display !== 'none') {
        autocompleteList = document.getElementById('outgoingAutocompleteList');
        inputElement = document.getElementById('outgoingItemId');
    } else {
        return; // No autocomplete list is active
    }

    // If the list is hidden or empty, do nothing
    if (autocompleteList.classList.contains('hidden')) return;

    const items = autocompleteList.querySelectorAll('.autocomplete-list-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault(); // Prevent page scrolling
        currentFocus = (currentFocus + 1) % items.length; // Move focus down, loop back to top
        setActiveItem(items, currentFocus); // Highlight the new focused item
    } else if (e.key === 'ArrowUp') {
        e.preventDefault(); // Prevent page scrolling
        currentFocus = (currentFocus - 1 + items.length) % items.length; // Move focus up, loop back to bottom
        setActiveItem(items, currentFocus); // Highlight the new focused item
    } else if (e.key === 'Enter') {
        if (currentFocus > -1) {
            e.preventDefault(); // Prevent form submission
            items[currentFocus].click(); // Simulate a click on the focused item
        }
    }
});

/**
 * Sets the active (highlighted) item in an autocomplete list for keyboard navigation.
 * @param {NodeList} items - A NodeList of all autocomplete list item elements.
 * @param {number} index - The index of the item to activate.
 */
function setActiveItem(items, index) {
    // Remove 'selected' class from all items
    items.forEach((item, i) => {
        item.classList.remove('selected');
    });
    // Add 'selected' class to the item at the specified index and scroll it into view
    if (index > -1 && index < items.length) {
        items[index].classList.add('selected');
        items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}


// Hide autocomplete list when clicking anywhere outside its container
document.addEventListener('click', function(event) {
    // Check if the click occurred outside any autocomplete container
    if (!event.target.closest('.autocomplete-container')) {
        // Hide both incoming and outgoing autocomplete lists
        document.getElementById('incomingAutocompleteList').classList.add('hidden');
        document.getElementById('outgoingAutocompleteList').classList.add('hidden');
    }
});

// Initial setup on page load: Initialize Supabase.
// This function will be called once the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', () => {
    initializeSupabase();
});
