// Load inventory from Local Storage (if any)
let inventory = JSON.parse(localStorage.getItem('inventory')) || [];

// Function to display inventory list
function displayInventory() {
    const inventoryList = document.getElementById('inventory-list');
    inventoryList.innerHTML = ''; // Clear existing list

    inventory.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.name}</td>
            <td>${item.quantity}</td>
            <td>$${item.price}</td>
            <td>
                <button onclick="editItem(${index})">Edit</button>
                <button onclick="deleteItem(${index})">Delete</button>
            </td>
        `;
        inventoryList.appendChild(row);
    });
}

// Function to add a new item
document.getElementById('add-item-form').addEventListener('submit', function (e) {
    e.preventDefault();

    const itemName = document.getElementById('item-name').value;
    const itemQuantity = document.getElementById('item-quantity').value;
    const itemPrice = document.getElementById('item-price').value;

    // Add item to inventory
    const newItem = {
        name: itemName,
        quantity: parseInt(itemQuantity),
        price: parseFloat(itemPrice),
    };

    inventory.push(newItem);
    localStorage.setItem('inventory', JSON.stringify(inventory));

    // Clear form and refresh the list
    this.reset();
    displayInventory();
});

// Function to delete an item
function deleteItem(index) {
    inventory.splice(index, 1); // Remove the item from the array
    localStorage.setItem('inventory', JSON.stringify(inventory)); // Update local storage
    displayInventory(); // Refresh the list
}

// Function to edit an item
function editItem(index) {
    const item = inventory[index];
    const newName = prompt('Enter new name:', item.name);
    const newQuantity = prompt('Enter new quantity:', item.quantity);
    const newPrice = prompt('Enter new price:', item.price);

    if (newName && newQuantity && newPrice) {
        inventory[index] = {
            name: newName,
            quantity: parseInt(newQuantity),
            price: parseFloat(newPrice),
        };
        localStorage.setItem('inventory', JSON.stringify(inventory));
        displayInventory(); // Refresh the list
    }
}
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzvvRa3ZCxpyzamImbApeH-1DyH9EZTCc2WoGlCkfGNo-hLDH_QORA1_LsMR6x_SHos/exec";

// Example POST request to add item
fetch(GOOGLE_SCRIPT_URL, {
  method: "POST",
  body: new URLSearchParams({
    name: "Hammer",
    quantity: 10,
    price: 5.99
  }),
});

// Initially display inventory
displayInventory();
