document.addEventListener("DOMContentLoaded", function() {
    const inventoryData = [
        { name: "Paint", sku: "123", quantity: "50", price: "$10.00" },
        { name: "Brush", sku: "124", quantity: "30", price: "$5.00" }
    ];

    const tableBody = document.getElementById("inventory-data");

    inventoryData.forEach(item => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${item.name}</td>
            <td>${item.sku}</td>
            <td>${item.quantity}</td>
            <td>${item.price}</td>
            <td><button>Edit</button> <button>Delete</button></td>
        `;
        tableBody.appendChild(row);
    });
});
