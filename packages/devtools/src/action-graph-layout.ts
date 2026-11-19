/** Position actions by function identity; see model-reaction/docs/DEVTOOLS.md. */
import { DEFAULT_LAYOUT_OPTIONS, layoutGraph, type GraphLayout } from './graph-layout';
import type { DependencyGraph, FieldInfo } from './protocol';

export const ACTION_STEP = 38;

interface ActionDeclaration {
    field: string;
    reactionIndex: number;
    actionIndex: number;
}

export interface ActionNode {
    id: string;
    label: string;
    declarations: ActionDeclaration[];
}

interface SharedActionNode extends ActionNode {
    fields: string[];
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ActionGraphLayout {
    fields: GraphLayout;
    fieldActions: Map<string, ActionNode[]>;
    sharedActions: SharedActionNode[];
    nodeWidth: number;
    width: number;
    height: number;
}

export function layoutActionGraph(
    graph: DependencyGraph,
    fields: Record<string, FieldInfo>
): ActionGraphLayout {
    const actions = new Map<string, ActionNode>();
    for (const [field, info] of Object.entries(fields)) {
        for (const action of info.actions ?? []) {
            const id = action.functionId === undefined
                ? JSON.stringify([field, action.reactionIndex, action.actionIndex])
                : `function:${action.functionId}`;
            let node = actions.get(id);
            if (!node) {
                node = {
                    id,
                    label: action.name || `r${action.reactionIndex} · action[${action.actionIndex}]`,
                    declarations: [],
                };
                actions.set(id, node);
            }
            node.declarations.push({
                field,
                reactionIndex: action.reactionIndex,
                actionIndex: action.actionIndex,
            });
        }
    }

    const fieldActions = new Map<string, ActionNode[]>();
    const shared: Array<ActionNode & { fields: string[] }> = [];
    for (const action of actions.values()) {
        const owners = [...new Set(action.declarations.map((declaration) => declaration.field))];
        if (owners.length > 1) {
            shared.push({ ...action, fields: owners });
        } else {
            const field = owners[0]!;
            if (!fieldActions.has(field)) fieldActions.set(field, []);
            fieldActions.get(field)!.push(action);
        }
    }

    const { nodeHeight, hGap, vGap } = DEFAULT_LAYOUT_OPTIONS;
    const nodeWidth = actions.size ? 240 : DEFAULT_LAYOUT_OPTIONS.nodeWidth;
    const nodeHeights = new Map<string, number>();
    for (const field of graph.nodes) {
        const count = fieldActions.get(field)?.length ?? 0;
        nodeHeights.set(field, nodeHeight + (count ? count * ACTION_STEP + 12 : 0));
    }
    const fieldLayout = layoutGraph(graph, {
        ...DEFAULT_LAYOUT_OPTIONS,
        nodeWidth,
        nodeHeights,
    });
    const positions = new Map(fieldLayout.nodes.map((node) => [node.id, node]));
    const sharedActions: SharedActionNode[] = shared.map((action) => {
        const owners = action.fields.map((field) => positions.get(field)).filter((node) => node !== undefined);
        const centerY = owners.length
            ? owners.reduce((sum, node) => sum + node.y + nodeHeight / 2, 0) / owners.length
            : 0;
        return {
            ...action,
            x: fieldLayout.width + hGap,
            y: Math.max(0, centerY - 22),
            width: nodeWidth - 42,
            height: 44,
        };
    }).sort((a, b) => a.y - b.y);
    let nextY = 0;
    for (const action of sharedActions) {
        action.y = Math.max(action.y, nextY);
        nextY = action.y + action.height + vGap;
    }

    return {
        fields: fieldLayout,
        fieldActions,
        sharedActions,
        nodeWidth,
        width: sharedActions.length ? sharedActions[0]!.x + sharedActions[0]!.width : fieldLayout.width,
        height: Math.max(fieldLayout.height, sharedActions.length ? nextY - vGap : 0),
    };
}
