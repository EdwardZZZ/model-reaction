import { createModel } from 'model-reaction';

interface Checkout {
    hasDiscount: boolean;
    discountCode: string;
    email: string;
}

/** Application checks are independent from the field model. */
export function checkCheckout(data: Readonly<Checkout>): Partial<Record<keyof Checkout, string>> {
    const errors: Partial<Record<keyof Checkout, string>> = {};
    if (data.hasDiscount && !data.discountCode.trim()) errors.discountCode = '请输入优惠码';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = '邮箱格式无效';
    return errors;
}

async function runExample(): Promise<void> {
    const model = createModel<Checkout>({
        hasDiscount: { type: 'boolean', default: false },
        discountCode: { type: 'string', default: '' },
        email: { type: 'string', default: '' },
    });
    try {
        const candidate: Checkout = { ...model.data, email: 'not-an-email' };
        const errors = checkCheckout(candidate);
        // A domain entry point can refuse a candidate before writing.
        if (Object.keys(errors).length === 0) model.setFields(candidate);
        console.log('预检错误:', errors, '保留原值:', model.data.email);

        // An editor can instead store incomplete values and check at submission.
        model.setFields({ hasDiscount: true, email: 'buyer@example.com' });
        await model.settled();
        console.log('提交检查:', checkCheckout(model.data));
        model.setField('discountCode', 'SAVE10');
        console.log('修正后:', checkCheckout(model.data));
    } finally {
        model.dispose();
    }
}

runExample().catch((error) => { console.error(error); process.exitCode = 1; });
