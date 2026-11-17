import { createModel } from 'model-reaction';

interface Product { name: string; price: number; quantity: number }
interface Order {
    email: string;
    products: Product[];
    couponCode: string;
    totalAmount: number;
    discountAmount: number;
    finalAmount: number;
}

async function submitOrder(data: Readonly<Order>): Promise<string[]> {
    const errors: string[] = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('邮箱格式无效');
    if (!data.products.length) errors.push('至少选择一个产品');
    if (data.products.some((item) => !Number.isFinite(item.price) || item.price < 0 ||
        !Number.isInteger(item.quantity) || item.quantity < 1)) errors.push('产品价格或数量无效');
    if (errors.length) return errors;
    // The server remains responsible for authoritative checks.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (data.email === 'existing@example.com') return ['邮箱已被注册'];
    console.log('提交订单:', data);
    return [];
}

async function runExample(): Promise<void> {
    const model = createModel<Order>({
        email: { type: 'string', default: '', transform: (value) => value.trim() },
        products: { type: 'array', default: [] },
        couponCode: { type: 'string', default: '' },
        totalAmount: { type: 'number', default: 0, reaction: {
            fields: ['products'],
            computed: ({ products }) => products.reduce(
                (sum: number, item: Product) => sum + item.price * item.quantity, 0),
        } },
        discountAmount: { type: 'number', default: 0, reaction: {
            fields: ['totalAmount', 'couponCode'],
            computed: ({ totalAmount, couponCode }) => couponCode === 'DISCOUNT10' ? totalAmount * 0.1 : 0,
        } },
        finalAmount: { type: 'number', default: 0, reaction: {
            fields: ['totalAmount', 'discountAmount'],
            computed: ({ totalAmount, discountAmount }) => totalAmount - discountAmount,
            action: [() => { console.log('计算落定:', model.data.finalAmount); }],
        } },
    });
    try {
        model.setFields({
            email: ' buyer@example.com ',
            products: [{ name: '产品1', price: 50, quantity: 2 }, { name: '产品2', price: 30, quantity: 1 }],
            couponCode: 'DISCOUNT10',
        });
        await model.settled();
        // Validate and submit the same snapshot; subsequent edits create a new map.
        const snapshot = model.data;
        console.log('业务错误:', await submitOrder(snapshot));
    } finally {
        model.dispose();
    }
}

runExample().catch((error) => { console.error(error); process.exitCode = 1; });
