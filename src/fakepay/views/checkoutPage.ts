type CheckoutPageInput = {
  orderId: string;
  providerPaymentId: string;
  amountCents: number;
  currency: string;
  returnTo: string | null;
};

export function renderFakepayCheckoutPage(input: CheckoutPageInput): string {
  const returnToQuery = input.returnTo ? `&returnTo=${encodeURIComponent(input.returnTo)}` : '';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>FakePay Checkout</title>
  </head>
  <body style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px;">
    <h1 style="margin-bottom: 8px;">FakePay Checkout (тестовая оплата)</h1>
    <p style="margin-top:0;color:#555;">Это демонстрационная страница: нажатие кнопки отправляет webhook в backend.</p>

    <div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:10px;padding:14px;margin:16px 0;">
      <p style="margin:4px 0;"><strong>Order ID:</strong> <code>${input.orderId}</code></p>
      <p style="margin:4px 0;"><strong>Provider Payment ID:</strong> <code>${input.providerPaymentId}</code></p>
      <p style="margin:4px 0;"><strong>Сумма:</strong> ${(input.amountCents / 100).toFixed(2)} ${input.currency}</p>
    </div>

    <form method="POST" action="/fakepay/complete/${input.providerPaymentId}?result=succeeded${returnToQuery}" style="margin-bottom:12px;">
      <button type="submit" style="padding:10px 16px;border-radius:8px;border:0;background:#1f883d;color:#fff;cursor:pointer;">Оплатить успешно</button>
    </form>

    <form method="POST" action="/fakepay/complete/${input.providerPaymentId}?result=failed${returnToQuery}">
      <button type="submit" style="padding:10px 16px;border-radius:8px;border:0;background:#cf222e;color:#fff;cursor:pointer;">Завершить с ошибкой</button>
    </form>

    <p style="margin-top:16px;color:#666;">После успешной оплаты вернитесь в Telegram и нажмите «Получить QR/Инструкции».</p>
  </body>
</html>`;
}
