// Function to handle showing claimed ticket state
function renderVoucherTicket(code, status = 'Active', expiresAt = null) {
    const container = document.getElementById('promo-voucher-container'); // Update ID to match your HTML ticket frame
    if (!container) return;

    if (status === 'Redeemed') {
        container.innerHTML = `
            <div class="voucher-card redeemed" style="background:#2d3748; color:#fff; padding:25px; border-radius:12px; text-align:center;">
                <div style="font-size: 2rem; color: #48bb78; margin-bottom: 10px;">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h3 style="font-size:1.4rem; margin-bottom:5px;">VOUCHER REDEEMED</h3>
                <p style="color:#cbd5e0; font-size:0.9rem;">Code: <strong>${code}</strong> has been successfully verified &amp; used at the cashier.</p>
                <div style="margin-top:15px; font-size:0.8rem; background:rgba(255,255,255,0.1); padding:8px; border-radius:6px;">
                    Thank you for dining at Cafe de Melle!
                </div>
            </div>
        `;
        return;
    }

    // Active Ticket state rendering...
}

// Auto-check stored voucher on page load / refresh
document.addEventListener('DOMContentLoaded', () => {
    const savedCode = localStorage.getItem('cdm_claimed_voucher');
    if (savedCode) {
        fetch(`/api/promo-codes/status/${savedCode}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    renderVoucherTicket(data.code, data.status);
                } else {
                    localStorage.removeItem('cdm_claimed_voucher');
                }
            })
            .catch(() => {});
    }
});