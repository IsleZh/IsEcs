/**
 * 实体 (Entity) 类。
 * 既是唯一标识符 (ID)，也是组件的容器。
 * 对应 Lua ECS 中的 Entity 对象。
 */
export class Entity {
    private components = new Map<Function, Component>();
    public destroyed = false;

    constructor(public id: number, private ecs: ECS) {}

    /**
     * 添加组件。
     * 别名: `addComp`
     */
    public add(component: Component): Entity {
        this.ecs.addComponent(this, component);
        return this;
    }

    /**
     * 获取组件。
     * 别名: `getComp`
     */
    public get<T extends Component>(componentClass: ClassType<T>): T | undefined {
        return this.components.get(componentClass) as T;
    }

    /**
     * 检查是否拥有组件。
     */
    public has(componentClass: Function): boolean {
        return this.components.has(componentClass);
    }

    /**
     * 移除组件。
     */
    public remove(componentClass: Function): void {
        this.ecs.removeComponent(this, componentClass);
    }

    /**
     * 检查实体是否已被销毁。
     */
    public isDestroyed(): boolean {
        return this.destroyed;
    }

    // --- Lua ECS 风格别名 ---
    public addComp(component: Component): Entity { return this.add(component); }
    public getComp<T extends Component>(componentClass: ClassType<T>): T | undefined { return this.get(componentClass); }
    
    // --- 内部方法 ---
    public _addComponentDirectly(component: Component) {
        this.components.set(component.constructor, component);
    }
    public _removeComponentDirectly(componentClass: Function) {
        this.components.delete(componentClass);
    }
    public _hasAll(componentClasses: Iterable<Function>): boolean {
        for (let cls of componentClasses) {
            if (!this.components.has(cls)) {
                return false;
            }
        }
        return true;
    }

    // --- 层级树 (Hierarchy) ---

    /**
     * 设置父节点。
     * 对应 Bevy 的 `set_parent`。
     */
    public setParent(parent: Entity): this {
        this.add(new Parent(parent));
        return this;
    }

    /**
     * 添加子节点。
     * 对应 Bevy 的 `add_child`。
     */
    public addChild(child: Entity): this {
        child.setParent(this);
        return this;
    }

    /**
     * 移除父节点 (变为孤儿)。
     * 对应 Bevy 的 `remove_parent`。
     */
    public removeParent(): this {
        this.remove(Parent);
        return this;
    }

    /**
     * 获取父节点。
     */
    public getParent(): Entity | undefined {
        return this.get(Parent)?.value;
    }

    /**
     * 获取所有子节点。
     */
    public getChildren(): Entity[] {
        return this.get(Children)?.value || [];
    }

    /**
     * 递归销毁实体及其所有子节点。
     * 对应 Bevy 的 `despawn_recursive`。
     */
    public despawnRecursive(): void {
        this.ecs.despawnRecursive(this);
    }
}

/**
 * 组件 (Component) 是状态数据的集合。每个组件实例都与一个实体 (Entity) 关联。
 * 支持定义静态生命周期钩子 (Bevy Hooks)。
 */
export abstract class Component { 
    public entity!: Entity;

    /**
     * 克隆组件。
     * 创建一个新实例并复制属性。
     */
    public clone(): this {
        const clone = new (this.constructor as any)();
        Object.assign(clone, this);
        return clone;
    }

    /**
     * 检查是否拥有兄弟组件。
     */
    public hasSibling(componentClass: Function): boolean {
        return this.entity.has(componentClass);
    }

    /**
     * 获取兄弟组件。
     */
    public getSibling<T extends Component>(componentClass: ClassType<T>): T | undefined {
        return this.entity.get(componentClass);
    }

    /**
     * 检查所属实体是否已被销毁。
     * 语法糖: `Comp.Entity.isDestroyed`
     */
    public isDestroyed(): boolean {
        return this.entity.isDestroyed();
    }

    /**
     * (可选) 当组件被添加到实体时调用。
     * 对应 Bevy 的 Component Hooks (OnAdd)。
     */
    static onAdd?(entity: Entity): void;

    /**
     * (可选) 当组件从实体移除前调用。
     * 对应 Bevy 的 Component Hooks (OnRemove)。
     */
    static onRemove?(entity: Entity): void;
}

/**
 * 父节点组件。
 * 拥有此组件的实体是另一个实体的子节点。
 * 对应 Bevy 的 `Parent`。
 */
export class Parent extends Component {
    constructor(public value: Entity) { super(); }

    static onAdd(entity: Entity): void {
        const parentComp = entity.get(Parent);
        if (!parentComp) return;
        
        const parentEntity = parentComp.value;
        let childrenComp = parentEntity.get(Children);
        if (!childrenComp) {
            childrenComp = new Children();
            parentEntity.add(childrenComp);
        }
        if (!childrenComp.value.includes(entity)) {
            childrenComp.value.push(entity);
        }
    }

    static onRemove(entity: Entity): void {
        const parentComp = entity.get(Parent);
        if (!parentComp) return;

        const parentEntity = parentComp.value;
        if (parentEntity.isDestroyed()) return;

        const childrenComp = parentEntity.get(Children);
        if (childrenComp) {
            const index = childrenComp.value.indexOf(entity);
            if (index !== -1) {
                childrenComp.value.splice(index, 1);
            }
        }
    }
}

/**
 * 子节点列表组件。
 * 自动维护，不要手动修改。
 * 对应 Bevy 的 `Children`。
 */
export class Children extends Component {
    public value: Entity[] = [];
}

/**
 * 资源 (Resource) 是全局唯一的组件，不属于任何特定实体。
 */
export abstract class Resource { }

/**
 * 事件 (Event) 用于系统之间的通信。
 */
export abstract class Event { }

/**
 * 系统 (System) 关注一组组件。它将对拥有该组件集合的每个实体运行。
 * T: 组件元组类型，例如 [Position, Velocity]
 */
export abstract class System<T extends Component[] = Component[]> {
    /**
     * 组件类的列表 (有序)，实体必须拥有所有这些组件，系统才能对其运行。
     * 这里的顺序决定了 update 方法中元组的顺序。
     */
    public abstract componentsRequired: ClassType<Component>[]

    /**
     * `update()` 方法在每一帧都会被系统调用。
     * @param components 符合条件的组件元组迭代器
     */
    public abstract update(components: Iterable<T>): void

    /**
     * ECS (World) 实例被提供给所有系统。
     */
    public ecs!: ECS

    /**
     * 是否为全局系统 (Global System)。
     * 如果为 true，ECS 不会为其自动维护实体集合 (checkES 将跳过)。
     * 这种系统通常用于只运行逻辑，或者通过 Query 参数手动获取实体。
     */
    public isGlobal = false;

    // --- 系统参数注入辅助方法 (System Parameter Injection Helpers) ---

    /**
     * 获取一个查询对象，用于遍历拥有特定组件的实体。
     * 模拟 Bevy 的 `Query<T>` 注入。
     */
    protected query<T extends Component>(componentClass: ClassType<T>): Iterable<T> {
        return this.ecs.query(componentClass);
    }

    /**
     * 高级查询：直接获取组件元组，模拟 Bevy 的 Query<(&A, &B)>
     * @param types 组件类列表
     */
    protected *queryTuple<T extends Component[]>(...types: { [K in keyof T]: ClassType<T[K]> }): IterableIterator<T> {
        // 获取当前系统缓存的实体集合
        const entities = this.ecs.getSystemEntities(this);
        
        for (const entity of entities) {
            // 检查是否所有组件都存在
            let match = true;
            const components: Component[] = [];
            
            for (const type of types) {
                const comp = entity.get(type);
                if (!comp) {
                    match = false;
                    break;
                }
                components.push(comp);
            }

            if (match) {
                yield components as T;
            }
        }
    }

    /**
     * 获取一个全局资源。
     * 模拟 Bevy 的 `Res<T>` 注入。
     */
    protected res<T extends Resource>(resourceClass: ClassType<T>): T {
        const resource = this.ecs.getResource(resourceClass);
        if (!resource) {
            throw new Error(`Resource ${resourceClass.name} not found!`);
        }
        return resource;
    }
}

export type ClassType<T> = new (...args: any[]) => T

/**
 * 事件缓冲区接口，用于缓冲模式的事件处理。
 * 包含 Push (写入) 和 Pop (读取) 操作。
 */
export interface EventBuffer<T extends Event> {
    push(event: T): void;
    pop(): Iterable<T>;
}

/**
 * 事件写入器 (EventWriter)，用于发送跨帧缓冲事件。
 * 对应 Bevy 的 `EventWriter<T>`。
 * 也可以称为 `EventPusher`。
 */
export class EventWriter<T extends Event> implements EventBuffer<T> {
    constructor(private ecs: ECS, private eventType: ClassType<T>) {}

    /**
     * 将事件推入缓冲区 (下一帧处理)。
     * 别名: `send`
     */
    public push(event: T): void {
        this.ecs.pushEvent(event);
    }

    /**
     * 批量推入事件。
     */
    public pushBatch(events: Iterable<T>): void {
        for (const event of events) {
            this.ecs.pushEvent(event);
        }
    }

    // --- 兼容旧接口 ---
    public send(event: T): void { this.push(event); }
    public sendBatch(events: Iterable<T>): void { this.pushBatch(events); }
    
    // EventBuffer 接口实现 (Writer 只负责 Push)
    public pop(): Iterable<T> { return []; } 
}

/**
 * 事件读取器 (EventReader)，用于读取上一帧的缓冲事件。
 * 对应 Bevy 的 `EventReader<T>`。
 * 也可以称为 `EventPopper`。
 */
export class EventReader<T extends Event> implements EventBuffer<T> {
    constructor(private ecs: ECS, private eventType: ClassType<T>) {}

    /**
     * 从缓冲区弹出(读取)上一帧的事件。
     * 注意：在双缓冲模式下，这只是读取，不会从缓冲区删除（缓冲区会在帧末自动清理）。
     * 别名: `read`
     */
    public pop(): Iterable<T> {
        return this.ecs.readEvents(this.eventType);
    }

    public isEmpty(): boolean {
        return this.ecs.eventCount(this.eventType) === 0;
    }

    // --- 兼容旧接口 ---
    public read(): Iterable<T> { return this.pop(); }

    // EventBuffer 接口实现 (Reader 只负责 Pop)
    public push(event: T): void { }
}

/**
 * 触发器 (Trigger)，用于包装立即执行的事件和目标实体。
 * 模仿 Bevy 的 `Trigger<E>`。
 */
export class Trigger<E extends Event> {
    constructor(public event: E, public entity?: Entity) {}
}

/**
 * 过滤器: 必须拥有某组件 (With)。
 */
export class With<T extends Component> {
    constructor(public type: ClassType<T>) {}
}

/**
 * 过滤器: 必须不拥有某组件 (Without)。
 */
export class Without<T extends Component> {
    constructor(public type: ClassType<T>) {}
}

export type Filter = With<any> | Without<any>;

/**
 * 查询 (Query) 对象。
 * 既是一个系统参数描述符，也是一个实际的迭代器。
 * 它继承自 System，利用 ECS 的机制来自动维护符合条件的实体集合。
 */
export class Query<T extends Component[]> extends System<T> {
    public componentsRequired: ClassType<Component>[];
    private accessTypes: ClassType<Component>[];
    private withoutTypes: Set<Function> = new Set();

    constructor(
        access: { [K in keyof T]: ClassType<T[K]> },
        filters: Filter[] = []
    ) {
        super();
        this.accessTypes = access as unknown as ClassType<Component>[];
        
        // 计算 componentsRequired: Access + With
        const reqs = new Set<ClassType<Component>>(this.accessTypes);
        
        for (const f of filters) {
            if (f instanceof With) {
                reqs.add(f.type);
            } else if (f instanceof Without) {
                this.withoutTypes.add(f.type);
            }
        }
        this.componentsRequired = Array.from(reqs);
    }

    /**
     * 添加 "With" 过滤器 (链式调用)。
     * 实体必须拥有这些组件。
     */
    public with(...types: ClassType<Component>[]): this {
        for (const type of types) {
            if (!this.componentsRequired.includes(type)) {
                this.componentsRequired.push(type);
            }
        }
        return this;
    }

    /**
     * 添加 "Without" 过滤器 (链式调用)。
     * 实体必须不拥有这些组件。
     */
    public without(...types: ClassType<Component>[]): this {
        for (const type of types) {
            this.withoutTypes.add(type);
        }
        return this;
    }

    public update(components: Iterable<T>): void {
        // Query 本身不执行 update 逻辑，它只是数据的提供者
    }

    /**
     * 迭代符合条件的实体组件元组。
     */
    public *[Symbol.iterator](): Iterator<T> {
        const entities = this.ecs.getSystemEntities(this);
        for (const entity of entities) {
            // 检查 Without 过滤器
            let pass = true;
            for (const without of this.withoutTypes) {
                if (entity.has(without)) {
                    pass = false;
                    break;
                }
            }
            if (!pass) continue;

            // 提取组件
            const tuple = this.accessTypes.map(type => entity.get(type)!);
            yield tuple as unknown as T;
        }
    }
}

/**
 * 创建 Query 的辅助函数 (函数式 API)。
 * @example query(Position, Velocity).with(Player).without(Enemy)
 */
export function query<T extends Component[]>(...access: { [K in keyof T]: ClassType<T[K]> }): Query<T> {
    return new Query(access);
}

/**
 * 资源参数描述符 (Res)。
 */
export class Res<T extends Resource> {
    constructor(public type: ClassType<T>) {}
}

/**
 * 创建 Res 的辅助函数 (函数式 API)。
 * @example res(Time)
 */
export function res<T extends Resource>(type: ClassType<T>): Res<T> {
    return new Res(type);
}

/**
 * 系统参数类型联合。
 */
export type SystemParam = Query<any> | Res<any>;

/**
 * 系统调度阶段。
 */
export enum Stage {
    Startup,
    Update,
    FixedUpdate
}

/**
 * EntityCommands 提供了一种链式调用来构建实体的方法 (类似 Bevy)。
 */
export class EntityCommands {
    constructor(private ecs: ECS, private entity: Entity) {}

    /**
     * 向实体添加组件。
     */
    public insert(component: Component): EntityCommands {
        this.ecs.addComponent(this.entity, component);
        return this;
    }

    /**
     * 为该实体添加一个观察者 (Observer)。
     * 当指定类型的事件在该实体上被触发时 (通过 `ecs.trigger(event, entity)`)，回调会被执行。
     */
    public observe<T extends Event>(
        eventClass: ClassType<T>, 
        callback: (trigger: Trigger<T>) => void
    ): EntityCommands {
        this.ecs.addEntityObserver(this.entity, eventClass, callback);
        return this;
    }

    /**
     * 立即触发一个事件到该实体。
     */
    public trigger(event: Event): EntityCommands {
        this.ecs.trigger(event, this.entity);
        return this;
    }

    /**
     * 获取实体 ID。
     */
    public id(): Entity {
        return this.entity;
    }

    /**
     * 添加子实体。
     * 对应 Bevy 的 `with_children`。
     */
    public withChildren(spawnChildren: (parent: Entity) => void): EntityCommands {
        spawnChildren(this.entity);
        return this;
    }
}

/**
 * ECS (Entity Component System) 类，充当 World 的角色。
 * 管理所有实体、组件、系统、资源和事件。
 */
export class ECS {
    // 主要状态
    private entities = new Map<number, Entity>() // ID -> Entity Object
    // 所有的系统 (包括 Query)，用于实体跟踪 (checkES)
    private systems = new Map<System, Set<Entity>>()
    // 按阶段划分的系统执行列表
    private systemsByStage = new Map<Stage, Set<System>>()

    // 组件索引 (Component Index) - 优化 query / getComps 性能
    private componentsByType = new Map<Function, Set<Component>>()

    // 资源 (Resources) - 单例组件
    private resources = new Map<Function, Resource>()

    // 事件 (Events) - 双缓冲队列
    private eventQueues = new Map<Function, Event[]>()
    private nextFrameEvents = new Map<Function, Event[]>()

    // 实体簿记
    private nextEntityID = 0
    private entitiesToDestroy = new Array<Entity>()

    // 生命周期系统 (Lifecycle Systems) - 对应 Lua 的 CompInitializeSystem/CompDestroySystem
    private initializeSystems = new Map<Function, Set<(entity: Entity, component: Component) => void>>()
    private destroySystems = new Map<Function, Set<(entity: Entity, component: Component) => void>>()

    // 立即事件系统 (Immediate Events / Observers)
    // 全局观察者
    private globalObservers = new Map<Function, Set<(trigger: Trigger<any>) => void>>()
    // 实体观察者: Entity -> EventType -> Callbacks
    private entityObservers = new Map<Entity, Map<Function, Set<(trigger: Trigger<any>) => void>>>()

    constructor() {
        this.systemsByStage.set(Stage.Startup, new Set());
        this.systemsByStage.set(Stage.Update, new Set());
        this.systemsByStage.set(Stage.FixedUpdate, new Set());
    }

    // --- Bevy-like API ---

    /**
     * 创建一个新的实体，并返回 EntityCommands 以便链式添加组件。
     * 对应 Bevy 的 `commands.spawn()` 或 Lua 的 `dse.createEntity()`。
     */
    public spawn(): EntityCommands {
        const entity = this.createEntity();
        return new EntityCommands(this, entity);
    }

    /**
     * 插入一个全局资源。
     * 对应 Bevy 的 `app.insert_resource()`。
     */
    public insertResource(resource: Resource): void {
        this.resources.set(resource.constructor, resource);
    }

    /**
     * 获取一个全局资源。
     * 对应 Bevy 的 `Res<T>`。
     */
    public getResource<T extends Resource>(resourceClass: ClassType<T>): T | undefined {
        return this.resources.get(resourceClass) as T;
    }

    /**
     * 获取单例组件 (Resource 的别名)。
     * 对应 Lua dse.getSingleComp。
     * 如果资源不存在，会自动创建并注册。
     */
    public getSingleComp<T extends Resource>(resourceClass: ClassType<T>): T {
        let res = this.getResource(resourceClass);
        if (!res) {
            res = new resourceClass();
            this.insertResource(res);
        }
        return res;
    }

    /**
     * 移除一个全局资源。
     */
    public removeResource(resourceClass: Function): void {
        this.resources.delete(resourceClass);
    }

    /**
     * 发送一个跨帧缓冲事件 (Buffered)。
     * 对应 Bevy 的 `EventWriter<T>.send()`。
     * 新命名: `pushEvent`
     */
    public pushEvent(event: Event): void {
        const type = event.constructor;
        if (!this.nextFrameEvents.has(type)) {
            this.nextFrameEvents.set(type, []);
        }
        this.nextFrameEvents.get(type)!.push(event);
    }

    /**
     * 立即触发一个事件 (Immediate / Observer)。
     * 这会同步调用所有注册了该事件类型的观察者 (包括全局和实体级)。
     * 对应 Lua 的 `event:trigger()` 或 Bevy 的 `commands.trigger()`.
     * 支持事件冒泡 (Event Propagation)。
     * 
     * @param event 要触发的事件对象
     * @param target (可选) 目标实体。如果提供，将触发该实体上的观察者，并向上冒泡。
     */
    public trigger(event: Event, target?: Entity): void {
        const type = event.constructor;
        const triggerObj = new Trigger(event, target);

        // 1. 触发实体观察者 (支持冒泡)
        if (target !== undefined) {
            let current: Entity | undefined = target;
            // 向上遍历父节点链
            while (current) {
                const entityObsMap = this.entityObservers.get(current);
                if (entityObsMap) {
                    const callbacks = entityObsMap.get(type);
                    if (callbacks) {
                        for (const callback of callbacks) {
                            callback(triggerObj);
                        }
                    }
                }
                // 获取父节点继续冒泡
                current = current.get(Parent)?.value;
            }
        }

        // 2. 触发全局观察者
        const globalCallbacks = this.globalObservers.get(type);
        if (globalCallbacks) {
            for (const callback of globalCallbacks) {
                callback(triggerObj);
            }
        }
    }

    /**
     * 递归销毁实体及其所有子节点。
     * 对应 Bevy 的 `despawn_recursive`。
     */
    public despawnRecursive(entity: Entity): void {
        // 1. 获取所有子节点 (复制列表以防修改)
        const children = entity.get(Children)?.value;
        if (children) {
            for (const child of [...children]) {
                this.despawnRecursive(child);
            }
        }
        // 2. 销毁自己
        this.removeEntity(entity);
    }

    /**
     * 读取上一帧发送的事件。
     * 对应 Bevy 的 `EventReader<T>`。
     */
    public readEvents<T extends Event>(eventClass: ClassType<T>): Iterable<T> {
        return (this.eventQueues.get(eventClass) as T[]) || [];
    }

    /**
     * 获取特定类型事件的数量 (上一帧)。
     */
    public eventCount(eventClass: Function): number {
        return this.eventQueues.get(eventClass)?.length || 0;
    }

    /**
     * 查询拥有特定组件的所有实体。
     * 对应 Bevy 的 `Query<T>`。
     * 优化: 使用 componentsByType 索引，复杂度从 O(N) 降低到 O(M) (M为该组件数量)。
     */
    public query<T extends Component>(componentClass: ClassType<T>): Iterable<T> {
        return (this.componentsByType.get(componentClass) as Set<T>) || [];
    }

    /**
     * 获取特定类型的所有组件。
     * 对应 Lua ECS 的 `dse.getComps(compType)`。
     * 别名: `query`
     */
    public getComps<T extends Component>(componentClass: ClassType<T>): Iterable<T> {
        return this.query(componentClass);
    }

    /**
     * 添加一个组件初始化系统 (Hook)。
     * 当指定类型的组件被添加到实体时调用。
     * 对应 Lua 的 `dse.createCompInitializeSystem` 或 Bevy 的 `Observer` (OnAdd)。
     */
    public addInitializeSystem<T extends Component>(
        componentClass: ClassType<T>, 
        callback: (entity: Entity, component: T) => void
    ): void {
        if (!this.initializeSystems.has(componentClass)) {
            this.initializeSystems.set(componentClass, new Set());
        }
        this.initializeSystems.get(componentClass)!.add(callback as any);
    }

    /**
     * 添加一个组件销毁系统 (Hook)。
     * 当指定类型的组件从实体移除时调用。
     * 对应 Lua 的 `dse.createCompDestroySystem` 或 Bevy 的 `Observer` (OnRemove)。
     */
    public addDestroySystem<T extends Component>(
        componentClass: ClassType<T>, 
        callback: (entity: Entity, component: T) => void
    ): void {
        if (!this.destroySystems.has(componentClass)) {
            this.destroySystems.set(componentClass, new Set());
        }
        this.destroySystems.get(componentClass)!.add(callback as any);
    }

    /**
     * 注册一个全局立即事件观察者 (Observer)。
     * 当 `trigger` 被调用时，该回调会立即执行。
     * 对应 Lua 的 `dse.createEventSystem` 或 Bevy 的 `app.observe()`.
     */
    public addObserver<T extends Event>(
        eventClass: ClassType<T>,
        callback: (trigger: Trigger<T>) => void
    ): void {
        if (!this.globalObservers.has(eventClass)) {
            this.globalObservers.set(eventClass, new Set());
        }
        this.globalObservers.get(eventClass)!.add(callback as any);
    }

    /**
     * 为特定实体注册一个观察者。
     */
    public addEntityObserver<T extends Event>(
        entity: Entity,
        eventClass: ClassType<T>,
        callback: (trigger: Trigger<T>) => void
    ): void {
        if (!this.entityObservers.has(entity)) {
            this.entityObservers.set(entity, new Map());
        }
        const entityMap = this.entityObservers.get(entity)!;
        
        if (!entityMap.has(eventClass)) {
            entityMap.set(eventClass, new Set());
        }
        entityMap.get(eventClass)!.add(callback as any);
    }

    // --- 兼容旧接口 ---

    public writeEvent(event: Event): void { this.pushEvent(event); }
    public triggerEvent(event: Event): void { this.trigger(event); }
    public addEventSystem<T extends Event>(eventClass: ClassType<T>, callback: (event: T) => void): void {
        // 适配旧回调签名: (event) -> void  适配为 (trigger) -> void
        this.addObserver(eventClass, (trigger) => callback(trigger.event));
    }

    // --- 原始 API (保留以兼容现有系统) ---

    public createEntity(): Entity {
        let id = this.nextEntityID;
        this.nextEntityID++;
        const entity = new Entity(id, this);
        this.entities.set(id, entity);
        return entity;
    }

    // 兼容旧别名
    public addEntity(): Entity { return this.createEntity(); }

    public removeEntity(entity: Entity): void {
        this.entitiesToDestroy.push(entity);
    }

    public addComponent(entity: Entity, component: Component): void {
        component.entity = entity; // 设置组件的实体引用
        entity._addComponentDirectly(component);
        
        // 更新组件索引
        const type = component.constructor;
        if (!this.componentsByType.has(type)) {
            this.componentsByType.set(type, new Set());
        }
        this.componentsByType.get(type)!.add(component);

        this.checkE(entity);

        // 1. 触发初始化系统 (Lua Style)
        const callbacks = this.initializeSystems.get(component.constructor);
        if (callbacks) {
            for (const callback of callbacks) {
                callback(entity, component);
            }
        }

        // 2. 触发组件静态 Hooks (Bevy Style)
        const compClass = component.constructor as typeof Component;
        if (compClass.onAdd) {
            compClass.onAdd(entity);
        }
    }

    public getComponents(entity: Entity): Entity {
        return entity; // Entity 本身就是容器
    }

    public removeComponent(entity: Entity, componentClass: Function): void {
        if (entity.has(componentClass)) {
            // 在移除前获取组件实例以触发销毁系统
            const component = entity.get(componentClass as any)!;
            
            // 1. 触发销毁系统 (Lua Style)
            const callbacks = this.destroySystems.get(componentClass);
            if (callbacks) {
                for (const callback of callbacks) {
                    callback(entity, component);
                }
            }

            // 2. 触发组件静态 Hooks (Bevy Style)
            const compClass = componentClass as typeof Component;
            if (compClass.onRemove) {
                compClass.onRemove(entity);
            }

            entity._removeComponentDirectly(componentClass);

            // 更新组件索引
            const typeSet = this.componentsByType.get(componentClass);
            if (typeSet) {
                typeSet.delete(component);
            }

            this.checkE(entity);
        }
    }

    /**
     * 添加一个支持 Bevy 风格参数注入的系统。
     * 
     * @example
     * ecs.addSystem(Stage.Update,
     *   [new Query([Position], [new With(Input)]), new Res(Time)],
     *   (q, time) => { ... }
     * );
     */
    public addSystem<Args extends any[]>(
        stage: Stage,
        params: { [K in keyof Args]: SystemParam },
        systemFn: (...args: Args) => void
    ): void;
    /**
     * 添加一个传统系统 (Class-based)。
     * 默认添加到 Update 阶段。
     */
    public addSystem(system: System): void;
    /**
     * 添加一个传统系统到指定阶段。
     */
    public addSystem(stage: Stage, system: System): void;
    
    public addSystem(arg1: any, arg2?: any, arg3?: any): void {
        let stage = Stage.Update;
        let system: System | null = null;

        // 重载解析
        if (typeof arg1 === 'number' && arg2 instanceof System) {
            // addSystem(Stage, System)
            stage = arg1;
            system = arg2;
        } else if (arg1 instanceof System) {
            // addSystem(System) -> Default Update
            stage = Stage.Update;
            system = arg1;
        } else if (typeof arg1 === 'number' && Array.isArray(arg2) && typeof arg3 === 'function') {
            // addSystem(Stage, Params, Fn)
            stage = arg1;
            const params = arg2 as SystemParam[];
            const callback = arg3;

            // 1. 注册所有的 Query 参数作为子系统 (用于跟踪实体)
            for (const param of params) {
                if (param instanceof Query) {
                    // Query 只需要被 ECS 跟踪，不需要加入执行列表
                    this.registerSystem(param);
                }
            }

            // 2. 创建一个全局系统来执行回调
            system = new class extends System<[]> {
                public componentsRequired = [];
                public isGlobal = true;

                public update(): void {
                    const args = params.map(p => {
                        if (p instanceof Query) {
                            return p;
                        } else if (p instanceof Res) {
                            const res = this.ecs.getResource(p.type);
                            if (!res) throw new Error(`Resource ${p.type.name} not found`);
                            return res;
                        }
                    });
                    callback(...args);
                }
            };
        } else if (Array.isArray(arg1) && typeof arg2 === 'function') {
             // 兼容旧的 addSystem(Params, Fn) -> Default Update
             // 递归调用自己
             this.addSystem(Stage.Update, arg1, arg2);
             return;
        }

        if (system) {
            this.registerSystem(system);
            this.systemsByStage.get(stage)?.add(system);
        }
    }

    /**
     * 内部方法：注册系统以进行实体跟踪。
     */
    private registerSystem(system: System): void {
        if (this.systems.has(system)) return;
        
        system.ecs = this;
        this.systems.set(system, new Set());
        for (let entity of this.entities.values()) {
            this.checkES(entity, system);
        }
    }

    public removeSystem(system: System): void {
        this.systems.delete(system);
        for (const stageSet of this.systemsByStage.values()) {
            stageSet.delete(system);
        }
    }

    /**
     * 获取系统缓存的实体集合。
     * 供 System.queryTuple 使用。
     */
    public getSystemEntities(system: System): Set<Entity> {
        return this.systems.get(system) || new Set();
    }

    /**
     * 运行 Startup 阶段的系统。
     * 应在游戏循环开始前调用一次。
     */
    public startup(): void {
        this.runStage(Stage.Startup);
    }

    /**
     * 运行 FixedUpdate 阶段的系统。
     * 应在物理循环中调用。
     */
    public fixedUpdate(): void {
        this.runStage(Stage.FixedUpdate);
    }

    /**
     * 运行 Update 阶段的系统。
     * 应在每帧调用。
     */
    public update(): void {
        // 1. 交换事件队列 (简单的双缓冲)
        this.eventQueues = this.nextFrameEvents;
        this.nextFrameEvents = new Map();

        // 2. 运行 Update 阶段系统
        this.runStage(Stage.Update);

        // 3. 移除标记为删除的实体
        while (this.entitiesToDestroy.length > 0) {
            this.destroyEntity(this.entitiesToDestroy.pop() as Entity);
        }
    }

    private runStage(stage: Stage): void {
        const systems = this.systemsByStage.get(stage);
        if (!systems) return;

        for (const system of systems) {
            // 构造组件元组迭代器
            const componentIterator = {
                *[Symbol.iterator]() {
                    const reqs = system.componentsRequired;
                    const entities = system.ecs.getSystemEntities(system);
                    
                    for (const entity of entities) {
                        const tuple = reqs.map(cls => entity.get(cls as any)!);
                        yield tuple;
                    }
                }
            };
            
            // @ts-ignore
            system.update(componentIterator);
        }
    }

    // --- 私有辅助方法 ---

    private destroyEntity(entity: Entity): void {
        entity.destroyed = true; // 标记为已销毁
        // 清理该实体的观察者
        this.entityObservers.delete(entity);

        this.entities.delete(entity.id);
        for (let entities of this.systems.values()) {
            entities.delete(entity);
        }
    }

    private checkE(entity: Entity): void {
        for (let system of this.systems.keys()) {
            this.checkES(entity, system);
        }
    }

    private checkES(entity: Entity, system: System): void {
        if (system.isGlobal) return;
        let need = system.componentsRequired;
        if (entity._hasAll(need)) {
            this.systems.get(system)!.add(entity);
        } else {
            this.systems.get(system)!.delete(entity);
        }
    }
}

export { ECS as World };