# ECS 框架文档 (Hybrid Architecture)

## 1. 概述 (Overview)

本项目的 ECS (Entity-Component-System) 框架采用了一种 **混合架构 (Hybrid Architecture)**。它结合了 **Rust Bevy Engine** 的现代化 API 设计风格与 **Lua ECS (ecs)** 的灵活立即响应机制。

**核心设计理念：**
*   **结构化数据流 (Bevy-like)**：使用 `World`, `System`, `Query`, `Resource` 等概念管理游戏状态，确保数据流向清晰，易于维护。
*   **立即响应能力 (Lua-style)**：保留了 `Observer` (观察者) 和 `Trigger` (触发器) 机制，允许在特定逻辑节点（如死亡结算、技能释放）立即同步执行代码，避免帧延迟。

---

## 2. 接口映射与对应关系 (API Mapping)

下表展示了本框架 API 与 Bevy Engine 及原 Lua ECS 的对应关系。

| 概念 | 本框架 API (TypeScript) | Bevy Engine (Rust) | Lua ECS | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **世界** | `ecs` / `World` | `App` / `World` | `ecs` (全局命名空间) | ECS 上下文容器 |
| **创建实体** | `ecs.spawn()` | `commands.spawn()` | `ecs.createEntity()` | 返回 `EntityCommands` 用于链式构建 |
| **添加组件** | `.insert(new Comp())` | `.insert(Comp)` | `entity:addComp(Comp)` | |
| **获取组件** | `entity.get(Comp)` | `Query.get(entity)` | `entity:getComp(Comp)` | 直接从实体获取组件 |
| **获取资源** | `ecs.getResource(Res)` | `Res<T>` | `ecs.getSingleComp(Res)` | 全局单例组件 |
| **缓冲事件** | `EventWriter.push()` | `EventWriter.send()` | 无 | **跨帧**，下一帧处理 (解耦) |
| **立即事件** | `ecs.trigger(evt)` | `commands.trigger()` | `event:trigger()` | **同步**，当前栈执行 (强逻辑) |
| **监听事件** | `ecs.addObserver()` | `app.observe()` | `ecs.createEventSystem()` | 监听立即事件 |
| **初始化Hook**| `ecs.addInitializeSystem`| `ComponentHooks` (OnAdd) | `ecs.createCompInitializeSystem` | 组件添加时触发 |
| **销毁Hook** | `ecs.addDestroySystem` | `ComponentHooks` (OnRemove)| `ecs.createCompDestroySystem` | 组件移除前触发 |

---

## 3. 详细使用指南 (Usage Guide)

### 3.1. 实体与组件 (Entities & Components)

使用 `spawn()` 开启链式调用，`insert()` 添加组件。
`Entity` 类现在提供了 Lua 风格的便捷方法。

```typescript
// 定义组件
class Position extends Component { constructor(public x: number, public y: number) { super(); } }
class Health extends Component { constructor(public value: number) { super(); } }

// 创建实体
const entity = ecs.spawn()
    .insert(new Position(0, 0))
    .insert(new Health(100))
    .id(); // 获取 Entity 对象

// Lua 风格访问
const pos = entity.get(Position); // 或 entity.getComp(Position)
entity.add(new Velocity(1, 0));   // 或 entity.addComp(...)

// 组件内部反向引用
class MyComp extends Component {
    update() {
        // 直接访问所属实体
        if (this.entity.isDestroyed()) return;
        
        // 访问兄弟组件
        const sibling = this.getSibling(OtherComp);
    }
}
```

### 3.2. 层级系统 (Hierarchy) - **新增特性**

本框架支持实体间的父子关系，用于构建复杂的组合对象（如：坦克底座+炮塔、UI 树、骨骼层级）。

**核心 API:**
*   `entity.setParent(parent)`: 设置父节点。
*   `entity.addChild(child)`: 添加子节点。
*   `entity.removeParent()`: 断开父子关系。
*   `entity.despawnRecursive()`: 递归销毁自己及所有子节点。
*   `commands.withChildren(callback)`: 链式创建子节点。

**组件:**
*   `Parent`: 指向父实体的组件。
*   `Children`: 包含子实体列表的组件（框架自动维护，请勿手动修改）。

```typescript
// 创建父子结构
ecs.spawn().insert(new TankBody())
    .withChildren((parent) => {
        // 子节点会自动获得 Parent 组件指向 parent
        // parent 会自动获得 Children 组件包含子节点
        ecs.spawn().insert(new TankTurret()).setParent(parent);
    });
```

### 3.3. 系统与查询 (Systems & Queries)

系统是 ECS 的逻辑核心，负责每帧更新游戏状态。本框架支持 **函数式 (Functional)** 和 **面向对象 (Class-based)** 两种定义方式，并提供了灵活的调度阶段。

#### A. 调度阶段 (Scheduling Stages)
系统可以被添加到不同的执行阶段：
*   `Stage.Startup`: 游戏启动时运行一次 (用于初始化资源、生成实体)。
*   `Stage.Update`: 每帧运行 (用于核心逻辑、输入处理、渲染同步)。
*   `Stage.FixedUpdate`: 固定时间间隔运行 (用于物理模拟)。

#### B. 函数式系统 (Functional Systems) - **推荐**
类似 Bevy 的现代化写法，利用 `query` 和 `res` 辅助函数进行参数注入，代码简洁优雅。

```typescript
import { query, res, Stage } from './ecs';

ecs.addSystem(Stage.Update, 
    [
        // Query 1: 所有移动物体 (位置 + 速度)
        query(Position, Velocity), 
        // Query 2: 仅玩家 (位置)，必须有 Player 组件，排除 Enemy 组件
        query(Position).with(Player).without(Enemy),
        // Resource: 时间
        res(Time)
    ], 
    (movers, players, time) => {
        // movers 自动推导为 Iterable<[Position, Velocity]>
        for (const [pos, vel] of movers) {
            pos.x += vel.x * time.deltaTime;
        }
    }
);
```

#### C. 面向对象系统 (Class-based Systems)
传统的继承写法，适合需要维护复杂内部状态（如缓存、状态机）的系统。

```typescript
class MovementSystem extends System<[Position, Velocity]> {
    // 必须声明组件依赖
    componentsRequired = [Position, Velocity];

    // 可选：维护系统内部状态
    private tempVector = new Vector3(0, 0, 0);

    update(components: Iterable<[Position, Velocity]>) {
        for (const [pos, vel] of components) {
            // ... 逻辑 ...
        }
    }
}

// 添加到默认的 Update 阶段
ecs.addSystem(new MovementSystem());
// 或指定阶段
ecs.addSystem(Stage.FixedUpdate, new PhysicsSystem());
```

### 3.3. 资源 (Resources)

资源是全局唯一的组件（单例），不属于任何实体。

```typescript
// 定义资源
class GameConfig extends Resource { public difficulty = 1.0; }

// 注册资源
ecs.insertResource(new GameConfig());

// 获取资源 (兼容 Lua 命名习惯)
// 如果资源不存在，getSingleComp 会自动创建并注册它 (Auto-Creation)
const config = ecs.getSingleComp(GameConfig); 
```

### 3.4. 事件系统 (Event System) - **核心差异点**

本框架区分了 **缓冲事件 (Buffered)** 和 **立即事件 (Immediate)**。

#### A. 缓冲事件 (EventBuffer)
*   **用途**：系统间解耦通信，不需要立即反馈。例如：播放音效、UI更新、成就统计。
*   **行为**：当前帧 `push`，下一帧 `pop` 处理。

```typescript
// 发送
const writer = new EventWriter(ecs, SoundEvent);
writer.push(new SoundEvent("boom.mp3"));

// 接收 (在 System 中)
const reader = new EventReader(ecs, SoundEvent);
for (const event of reader.pop()) {
    playSound(event.clip);
}
```

#### B. 立即事件 / 观察者 (Observers / Triggers)
*   **用途**：强逻辑关联，需要立即改变控制流。例如：死亡结算、伤害计算、状态机跳转。
*   **行为**：调用 `trigger` 时，所有监听器立即同步执行。

```typescript
// 1. 注册全局观察者
ecs.addObserver(DeathEvent, (trigger) => {
    console.log(`Entity ${trigger.entity} died!`);
});

// 2. 注册实体级观察者 (仅监听特定实体)
ecs.spawn()
    .insert(new Player())
    .observe(DeathEvent, (trigger) => {
        console.log("Game Over!"); // 只有玩家死时触发
    });

// 3. 触发事件
ecs.trigger(new DeathEvent(), targetEntity);
```

#### C. 事件冒泡 (Event Propagation)
当使用 `trigger` 触发立即事件，并指定了目标实体时，事件会沿着 **Parent 链** 向上冒泡。

*   **机制**：Target -> Parent -> GrandParent -> ... -> Root。
*   **用途**：UI 点击事件（按钮 -> 面板 -> 窗口）、伤害传递（炮塔受击 -> 坦克扣血）。

```typescript
// 父节点监听
parent.observe(ClickEvent, (trigger) => {
    console.log("Parent clicked via child:", trigger.entity.id);
});

// 在子节点触发
ecs.trigger(new ClickEvent(), child); // 父节点也会收到回调
```

### 3.6. 生命周期钩子 (Lifecycle Hooks)

用于在组件添加或移除时执行特定逻辑（如初始化数据、清理资源）。

**方式 A: 静态方法 (Bevy Style)**
直接在组件类中定义静态方法。

```typescript
class PhysicsBody extends Component {
    static onAdd(entity: Entity) {
        console.log("Body added to", entity.id);
    }
    
    static onRemove(entity: Entity) {
        console.log("Body removed from", entity.id);
    }
}
```

**方式 B: 注册系统 (Lua Style)**
在外部注册回调。

```typescript
// 初始化系统 (OnAdd)
ecs.addInitializeSystem(PhysicsBody, (entity, body) => {
    body.initializePhysicsEngine();
});

// 销毁系统 (OnRemove)
ecs.addDestroySystem(PhysicsBody, (entity, body) => {
    // 注意：此时组件尚未被物理删除，仍可访问数据
    body.removeFromPhysicsWorld();
});
```

---

## 4. 设计模式与数据结构分析

### 4.1. 组合模式 (Composition over Inheritance)
ECS 的核心。实体不再继承自 `GameObject`，而是由 `Component` 组合而成。这消除了深层继承树带来的僵化。

### 4.2. 双缓冲模式 (Double Buffering)
用于 `EventBuffer`。
*   `nextFrameEvents` (写入队列)
*   `eventQueues` (读取队列)
*   在 `ecs.update()` 开始时交换这两个队列。这保证了系统执行顺序不会影响事件的接收（所有系统在同一帧看到的事件是一样的）。

### 4.3. 观察者模式 (Observer Pattern)
用于 `Trigger` 和 `Lifecycle Hooks`。
*   数据结构：`Map<EventType, Set<Callback>>`。
*   优点：极高的灵活性，支持“推”模式 (Push)，避免了每帧轮询 (Poll) 的开销。

### 4.4. 命令模式 (Command Pattern)
`EntityCommands` 类封装了对 World 的修改操作。虽然目前是立即执行，但其 API 设计允许未来扩展为延迟执行（Deferred Execution），以便在并行计算时保证线程安全。

---

## 5. 未来升级方向 (Roadmap)

基于 Bevy 的特性和当前架构，建议的下一步升级方向：

1.  **调度器 (Scheduler) 与 阶段 (Stages)** [已实现]
    *   已支持 `Startup`, `Update`, `FixedUpdate` 阶段。

2.  **系统参数注入 (System Params)** [已实现]
    *   已支持 `query()`, `res()` 注入，以及函数式系统定义。

3.  **插件系统 (Plugins)**
    *   **现状**：手动在 `main.ts` 中添加 System。
    *   **目标**：`app.addPlugin(PhysicsPlugin)`。
    *   **价值**：模块化复用代码（如将 WFC 算法封装为一个插件）。

4.  **Archetype 存储优化 (可选)**
    *   **现状**：`Map<ComponentClass, ComponentInstance>`。
    *   **目标**：将拥有相同组件集合的实体存储在连续内存块中 (Archetype Table)。
    *   **价值**：提高 CPU 缓存命中率，提升大规模实体遍历性能（在 JS/TS 中收益取决于引擎优化程度）。

5.  **状态管理 (States)**
    *   **现状**：通常使用全局变量或 Resource 手动判断 `if (game.state == 'playing')`。
    *   **目标**：实现类似 Bevy 的 `States` 及其调度。
    *   **特性**：`OnEnter(State)`, `OnExit(State)`, `OnTransition` 以及 `run_if(in_state(State))`。
    *   **价值**：优雅地管理游戏流程（菜单 -> 游戏 -> 暂停 -> 结算），消除系统内部的大量 `if` 判断。

6.  **变更检测 (Change Detection)**
    *   **现状**：系统每帧处理所有组件，无论数据是否发生变化。
    *   **目标**：实现 `Changed<T>` 和 `Added<T>` 过滤器。
    *   **价值**：极大优化性能。例如：渲染系统只更新那些位置发生变化的实体，而不是每帧更新所有实体。

7.  **运行条件 (Run Conditions)**
    *   **现状**：在 System 内部手动写 `if (!shouldRun) return`。
    *   **目标**：支持声明式条件，如 `system.runIf(conditionFunction)`。
    *   **价值**：让系统逻辑更纯粹，复用通用的条件逻辑（如 `run_if(on_event(MyEvent))`）。

8.  **系统集合 (System Sets)**
    *   **现状**：系统是独立的。
    *   **目标**：将一组系统打包，统一应用配置（如统一设置运行条件、统一设置执行顺序）。
