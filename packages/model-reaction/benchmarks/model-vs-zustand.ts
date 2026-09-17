/* eslint-disable no-console */
/**
 * model-reaction vs zustand 性能基准测试
 *
 * 运行: npx tsx benchmarks/model-vs-zustand.ts
 *
 * 仅作为本机参考数据，不同硬件会有差异。
 */
import { createStore } from 'zustand/vanilla';
import { createModel, ValidationRules } from '../src/index';

// 静音 model-reaction 校验/反应失败的 console.error 噪音
const _origError = console.error;
console.error = (...args: any[]) => {
    const first = args[0];
    if (
        typeof first === 'string' &&
        (first.startsWith('[validation]') || first.startsWith('[reaction]'))
    ) {
        return;
    }
    _origError.apply(console, args);
};

// ----------------------------- helpers -----------------------------

async function bench(
    name: string,
    runs: number,
    fn: () => void | Promise<void>
): Promise<number> {
    // 预热
    await fn();
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        await fn();
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    console.log(
        `  ${name.padEnd(40)} median=${median.toFixed(3)}ms  (min=${samples[0].toFixed(
            3
        )}, max=${samples[samples.length - 1].toFixed(3)})`
    );
    return median;
}

interface Row {
    scenario: string;
    zustand: number;
    model: number;
}
const results: Row[] = [];

function record(scenario: string, zustand: number, model: number) {
    results.push({ scenario, zustand, model });
}

// ----------------------------- 1. 创建 1000 个 store -----------------------------

async function bench_create() {
    console.log('\n[1] 创建 1000 个 store / model');
    const RUNS = 30;

    const z = await bench('zustand createStore x1000', RUNS, () => {
        for (let i = 0; i < 1000; i++) {
            createStore(() => ({ name: '', age: 0 }));
        }
    });

    const m = await bench('model-reaction createModel x1000', RUNS, () => {
        for (let i = 0; i < 1000; i++) {
            const mm = createModel<{ name: string; age: number }>({
                name: { type: 'string', default: '' },
                age:  { type: 'number', default: 0 },
            });
            mm.dispose();
        }
    });

    record('创建 1000 个实例', z, m);
}

// ----------------------------- 2. 1000 次写入（无校验） -----------------------------

async function bench_setNoValidate() {
    console.log('\n[2] 1000 次写入（无校验）');
    const RUNS = 30;
    const N = 1000;

    const z = await bench('zustand setState x1000', RUNS, () => {
        const store = createStore<{ n: number; set: (n: number) => void }>(
            (set) => ({ n: 0, set: (n) => set({ n }) })
        );
        for (let i = 0; i < N; i++) store.getState().set(i);
    });

    const m = await bench('model-reaction setField x1000 (await)', RUNS, async () => {
        const mm = createModel<{ n: number }>({
            n: { type: 'number', default: -1 },
        });
        for (let i = 0; i < N; i++) await mm.setField('n', i);
        mm.dispose();
    });

    record('1000 次写入（无校验，串行 await）', z, m);
}

// ----------------------------- 3. 1000 次写入（含必填校验） -----------------------------

async function bench_setWithValidate() {
    console.log('\n[3] 1000 次写入（含必填校验）');
    const RUNS = 20;
    const N = 1000;

    const z = await bench('zustand setState + 手写校验 x1000', RUNS, () => {
        const store = createStore<{
            v: string;
            err: string;
            set: (v: string) => void;
        }>((set) => ({
            v: 'init',
            err: '',
            set: (v) => set({ v, err: v.length === 0 ? 'required' : '' }),
        }));
        for (let i = 0; i < N; i++) {
            store.getState().set(i % 10 === 0 ? '' : 'v' + i);
        }
    });

    const m = await bench(
        'model-reaction setField + validator x1000',
        RUNS,
        async () => {
            const mm = createModel<{ v: string }>({
                v: {
                    type: 'string',
                    default: 'init',
                    validator: [ValidationRules.required],
                },
            });
            for (let i = 0; i < N; i++) {
                await mm.setField('v', i % 10 === 0 ? '' : 'v' + i);
            }
            mm.dispose();
        }
    );

    record('1000 次写入（含必填校验）', z, m);
}

// ----------------------------- 4. 单字段订阅 1000 次写入 -----------------------------

async function bench_singleSubscribe() {
    console.log('\n[4] 单字段订阅 + 1000 次写入');
    const RUNS = 20;
    const N = 1000;

    const z = await bench('zustand subscribe (selector) x1000', RUNS, () => {
        const store = createStore<{ a: number; b: number; setA: (n: number) => void }>(
            (set) => ({ a: -1, b: 0, setA: (n) => set({ a: n }) })
        );
        let count = 0;
        const unsub = store.subscribe((s, prev) => {
            if (s.a !== prev.a) count++;
        });
        for (let i = 0; i < N; i++) store.getState().setA(i);
        unsub();
        if (count < N - 1) throw new Error('zustand count=' + count);
    });

    const m = await bench(
        'model-reaction subscribeField x1000',
        RUNS,
        async () => {
            const mm = createModel<{ a: number; b: number }>({
                a: { type: 'number', default: -1 },
                b: { type: 'number', default: 0 },
            });
            let count = 0;
            const unsub = mm.subscribeField('a', () => {
                count++;
            });
            for (let i = 0; i < N; i++) await mm.setField('a', i);
            unsub();
            mm.dispose();
            if (count < N - 1) throw new Error('model count=' + count);
        }
    );

    record('单字段订阅（1000 次写入）', z, m);
}

// ----------------------------- 5. 字段隔离：写 b 不应通知 a 订阅者 -----------------------------

async function bench_isolation() {
    console.log('\n[5] 字段隔离：1000 个 a 订阅者，写 b 1000 次');
    const RUNS = 10;
    const N = 1000;

    const z = await bench('zustand 1000 selectors，写 b x1000', RUNS, () => {
        const store = createStore<{
            a: number;
            b: number;
            setB: (n: number) => void;
        }>((set) => ({ a: 0, b: 0, setB: (n) => set({ b: n }) }));

        const unsubs: Array<() => void> = [];
        for (let i = 0; i < N; i++) {
            unsubs.push(
                store.subscribe((s, p) => {
                    if (s.a !== p.a) {
                        // noop
                    }
                })
            );
        }
        for (let i = 0; i < N; i++) store.getState().setB(i);
        unsubs.forEach((u) => u());
    });

    const m = await bench(
        'model 1000 个 a 订阅者，写 b x1000',
        RUNS,
        async () => {
            const mm = createModel<{ a: number; b: number }>({
                a: { type: 'number', default: 0 },
                b: { type: 'number', default: 0 },
            });
            const unsubs: Array<() => void> = [];
            for (let i = 0; i < N; i++) {
                unsubs.push(mm.subscribeField('a', () => {}));
            }
            for (let i = 0; i < N; i++) await mm.setField('b', i);
            unsubs.forEach((u) => u());
            mm.dispose();
        }
    );

    record('字段隔离（1000 订阅 / 1000 写）', z, m);
}

// ----------------------------- 6. 派生值（reaction vs selector） -----------------------------

async function bench_derived() {
    console.log('\n[6] 派生值：total = qty * price，1000 次写入触发');
    const RUNS = 20;
    const N = 1000;

    const z = await bench('zustand selector total x1000', RUNS, () => {
        const store = createStore<{
            qty: number;
            price: number;
            setQty: (n: number) => void;
        }>((set) => ({
            qty: 1,
            price: 100,
            setQty: (n) => set({ qty: n }),
        }));
        let last = 0;
        const unsub = store.subscribe((s) => {
            last = s.qty * s.price;
        });
        for (let i = 0; i < N; i++) store.getState().setQty(i);
        unsub();
        if (last < 0) throw new Error();
    });

    const m = await bench('model reaction total x1000', RUNS, async () => {
        const mm = createModel<{
            qty: number;
            price: number;
            total: number;
        }>({
            qty: { type: 'number', default: 1 },
            price: { type: 'number', default: 100 },
            total: {
                type: 'number',
                default: 100,
                reaction: {
                    fields: ['qty', 'price'],
                    computed: (values: Record<string, any>) =>
                        values.qty * values.price,
                },
            },
        });
        for (let i = 0; i < N; i++) await mm.setField('qty', i);
        mm.dispose();
    });

    record('派生值更新（1000 次）', z, m);
}

// ----------------------------- 主流程 -----------------------------

async function main() {
    console.log('\n=== model-reaction vs zustand benchmark ===');
    console.log('node:', process.version);
    console.log('platform:', process.platform, process.arch);

    await bench_create();
    await bench_setNoValidate();
    await bench_setWithValidate();
    await bench_singleSubscribe();
    await bench_isolation();
    await bench_derived();

    console.log('\n=== 汇总（中位数, ms，越低越好）===');
    console.log('| 场景 | zustand | model-reaction | model/zustand |');
    console.log('| --- | --- | --- | --- |');
    for (const r of results) {
        const ratio = r.model / r.zustand;
        console.log(
            `| ${r.scenario} | ${r.zustand.toFixed(2)} | ${r.model.toFixed(
                2
            )} | ${ratio.toFixed(1)}x |`
        );
    }
    console.log('');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
