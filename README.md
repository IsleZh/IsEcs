# ECS 框架实战示例 (Examples)

本文档提供了基于本 ECS 框架的多种常见游戏场景实现示例，涵盖了基础用法、层级结构、事件系统及综合应用。

---

## 1. 基础场景：移动与输入 (Movement & Input)
**场景描述**：一个简单的 RPG 角色，根据键盘输入移动。
**风格选择**：**函数式 (Functional)** - 逻辑简单，无内部状态，适合函数式写法。

```typescript
import { query, res, Stage } from './ecs';

// --- Components ---
class Position extends Component { constructor(public x: number, public y: number) { super(); } }
class Velocity extends Component { constructor(public x: number, public y: number) { super(); } }
class InputState extends Resource { public x: number = 0; public y: number = 0; }

// --- Setup ---
ecs.insertResource(new InputState());

// System 1: 输入处理 (Update 阶段)
ecs.addSystem(Stage.Update, 
    [res(InputState)], 
    (input) => {
        // 模拟读取键盘
        input.x = 0; 
        // if (keyboard.isDown('ArrowRight')) input.x += 1;
    }
);

// System 2: 移动逻辑 (Update 阶段)
ecs.addSystem(Stage.Update,
    [query(Position, Velocity), res(InputState)],
    (movers, input) => {
        const dt = 0.016; 
        for (const [pos, vel] of movers) {
            vel.x = input.x * 100;
            pos.x += vel.x * dt;
            pos.y += vel.y * dt;
        }
    }
);

// Spawn Player
ecs.spawn()
    .insert(new Position(0, 0))
    .insert(new Velocity(0, 0));
```

---

## 2. 层级结构：坦克与炮塔 (Hierarchy & Composition)
**场景描述**：坦克由底座和炮塔组成。移动底座时，炮塔跟随。
**风格选择**：**面向对象 (Class-based)** - 逻辑稍复杂，且需要访问组件所属的 Entity (通过 `comp.entity`)。

```typescript
// --- Components ---
class TankBody extends Component {}
class TankTurret extends Component {}
class Transform extends Component { constructor(public x=0, public y=0, public rotation=0) { super(); } }
class GlobalTransform extends Component { constructor(public x=0, public y=0, public rotation=0) { super(); } }

// --- Systems ---
class TransformPropagateSystem extends System<[Transform, GlobalTransform]> {
    // 声明依赖 (数组)
    componentsRequired = [Transform, GlobalTransform];
    
    update(components: Iterable<[Transform, GlobalTransform]>) {
        for (const [local, global] of components) {
            // 通过组件反向获取 Entity，再获取父节点
            const parent = local.entity.getParent();

            if (parent && parent.has(GlobalTransform)) {
                const parentGlobal = parent.get(GlobalTransform)!;
                global.x = parentGlobal.x + local.x; 
                global.y = parentGlobal.y + local.y;
                global.rotation = parentGlobal.rotation + local.rotation;
            } else {
                global.x = local.x;
                global.y = local.y;
                global.rotation = local.rotation;
            }
        }
    }
}

// --- Setup ---
ecs.addSystem(Stage.Update, new TransformPropagateSystem());

// 创建坦克
const tank = ecs.spawn()
    .insert(new TankBody())
    .insert(new Transform(100, 100, 0))
    .insert(new GlobalTransform())
    .withChildren((parent) => {
        ecs.spawn()
            .insert(new TankTurret())
            .insert(new Transform(0, 10, 0))
            .insert(new GlobalTransform())
            .setParent(parent);
    })
    .id();
```

---

## 3. 事件冒泡：UI 点击系统 (Event Bubbling)
**场景描述**：一个 UI 面板包含一个按钮。点击按钮时，按钮响应点击，同时面板也需要知道自己被点击了（例如用于把面板置顶）。

```typescript
// --- Events ---
class ClickEvent extends Event { constructor(public x: number, public y: number) { super(); } }

// --- Components ---
class UIPanel extends Component { name: string; constructor(name: string) { super(); this.name = name; } }
class UIButton extends Component { label: string; constructor(label: string) { super(); this.label = label; } }

// --- Setup ---

// 1. 创建 UI 结构
const panel = ecs.spawn()
    .insert(new UIPanel("MainPanel"))
    .id();

const button = ecs.spawn()
    .insert(new UIButton("Close"))
    .setParent(panel) // 按钮挂在面板下
    .id();

// 2. 注册观察者 (Observers)

// 按钮逻辑：处理具体的点击行为
button.observe(ClickEvent, (trigger) => {
    const btn = trigger.entity!.get(UIButton)!;
    console.log(`Button '${btn.label}' clicked at ${trigger.event.x}, ${trigger.event.y}`);
    // 可以在这里阻止冒泡吗？目前框架暂未实现 stopPropagation，默认会一直冒泡
});

// 面板逻辑：处理通用的容器行为
panel.observe(ClickEvent, (trigger) => {
    const pnl = trigger.entity!.get(UIPanel)!;
    console.log(`Panel '${pnl.name}' received click event from child.`);
});

// 3. 模拟点击
// 假设鼠标点击了按钮
ecs.trigger(new ClickEvent(500, 300), button);

// 输出:
// "Button 'Close' clicked..."
// "Panel 'MainPanel' received click event..."
```

---

## 4. 缓冲事件：碰撞与音效 (Buffered Events)
**场景描述**：物理系统检测到碰撞，发送 `CollisionEvent`。音效系统在下一帧处理这些事件。
**风格选择**：**面向对象 (Class-based)** - 需要访问 `this.ecs` 来创建 EventWriter/Reader (目前函数式参数暂不支持 EventBuffer)。

```typescript
// --- Events ---
class CollisionEvent extends Event { 
    constructor(public entityA: Entity, public entityB: Entity) { super(); } 
}

// --- Systems ---
class PhysicsSystem extends System<[Collider]> {
    componentsRequired = [Collider];
    
    update(colliders: Iterable<[Collider]>) {
        // ... 物理检测逻辑 ...
        if (checkCollision(a, b)) {
            // 发送缓冲事件
            const writer = new EventWriter(this.ecs, CollisionEvent);
            writer.push(new CollisionEvent(a, b));
        }
    }
}

class AudioSystem extends System<[]> {
    componentsRequired = []; // 不需要遍历实体
    
    update() {
        // 读取上一帧发生的所有碰撞
        const reader = new EventReader(this.ecs, CollisionEvent);
        for (const event of reader.pop()) {
            console.log("Play Sound: BOOM!");
        }
    }
}

// --- Setup ---
ecs.addSystem(Stage.FixedUpdate, new PhysicsSystem());
ecs.addSystem(Stage.Update, new AudioSystem());
```

---

## 5. 综合应用：技能系统 (Skills & Hooks)
**场景描述**：释放一个火球技能。
1.  **Spawn**: 创建火球实体。
2.  **Hook**: 火球创建时自动播放“发射”音效。
3.  **System**: 火球飞行。
4.  **Trigger**: 火球命中敌人，触发 `DamageEvent`。
5.  **Observer**: 敌人扣血，如果死亡触发 `DeathEvent`。

```typescript
// --- Components ---
class Fireball extends Component {
    // 生命周期 Hook：创建时自动播放音效
    static onAdd(entity: Entity) {
        console.log("SFX: Fireball Launch Whoosh!");
    }
}
class Health extends Component { constructor(public val: number) { super(); } }

// --- Events ---
class DamageEvent extends Event { constructor(public amount: number) { super(); } }

// --- Setup ---

// 敌人实体
const enemy = ecs.spawn()
    .insert(new Health(50))
    .observe(DamageEvent, (trigger) => {
        const hp = trigger.entity!.get(Health)!;
        hp.val -= trigger.event.amount;
        console.log(`Enemy took ${trigger.event.amount} dmg. HP: ${hp.val}`);
        
        if (hp.val <= 0) {
            trigger.entity!.despawnRecursive(); // 死亡销毁
            console.log("Enemy died.");
        }
    })
    .id();

// 模拟火球系统逻辑
function castFireball(target: Entity) {
    // 1. 创建火球 (触发 onAdd)
    const fireball = ecs.spawn().insert(new Fireball()).id();
    
    // ... 几秒后火球击中 ...
    
    // 2. 触发伤害 (立即执行 Observer)
    ecs.trigger(new DamageEvent(20), target);
    
    // 3. 销毁火球
    fireball.despawnRecursive();
}

// 执行
castFireball(enemy);
castFireball(enemy);
castFireball(enemy); // 第三次击中，HP < 0，敌人销毁
```

---

## 6. [框架层待开发] 状态机 (State Machine)
**场景描述**：实现一个简单的玩家状态机 (Idle -> Run -> Jump)。
**风格选择**：**面向对象 (Class-based)** - 状态机逻辑通常包含多个辅助方法 (`changeState`, `enter`, `exit`)，类结构更清晰。

```typescript
// --- Components ---
enum PlayerState { Idle, Run, Jump }
class StateMachine extends Component { constructor(public current: PlayerState = PlayerState.Idle) { super(); } }

// --- Systems ---
class PlayerStateSystem extends System<[StateMachine, InputComponent, Velocity]> {
    componentsRequired = [StateMachine, InputComponent, Velocity];

    update(components: Iterable<[StateMachine, InputComponent, Velocity]>) {
        for (const [fsm, input, vel] of components) {
            // 状态转换逻辑
            switch (fsm.current) {
                case PlayerState.Idle:
                    if (input.x !== 0) this.changeState(fsm, PlayerState.Run);
                    break;
                // ...
            }
        }
    }

    private changeState(fsm: StateMachine, newState: PlayerState) {
        // Exit Logic
        if (fsm.current === PlayerState.Run) { /* stop run anim */ }
        
        fsm.current = newState;
        
        // Enter Logic
        if (newState === PlayerState.Jump) { /* play jump sound */ }
    }
}
```

---

## 7. [框架层待开发] UI 开发与动画 (UI & Animation)
**场景描述**：实现一个按钮，鼠标悬停时变色。
**风格选择**：**函数式 (Functional)** - UI 状态更新逻辑通常很直观。

### A. 基础交互 (Bevy Style)

```typescript
// --- Components ---
class Button extends Component {}
class Style extends Component { constructor(public color: string, public scale: number = 1) { super(); } }
enum InteractionState { None, Hovered, Pressed }
class Interaction extends Component { public state = InteractionState.None; }

// --- Systems ---
ecs.addSystem(Stage.Update,
    [query(Button, Interaction, Style)],
    (buttons) => {
        for (const [btn, interaction, style] of buttons) {
            switch (interaction.state) {
                case InteractionState.None:
                    style.color = 'blue';
                    break;
                case InteractionState.Hovered:
                    style.color = 'orange';
                    break;
                case InteractionState.Pressed:
                    style.color = 'red';
                    break;
            }
        }
    }
);
```

### B. 协程控制动画 (Godot/Unity Style)
**问题**：Godot 的 `await tween.finished` 非常直观。这与 ECS 冲突吗？
**回答**：**不冲突，但需要适配层**。
ECS 是“每帧轮询”的，而 `await` 是“挂起等待”的。我们可以通过 **ScriptRunner (协程运行器)** 将两者结合。

**实现思路**：
1.  `ScriptRunner` 组件保存一个 Generator (`function*`)。
2.  System 每帧调用 `generator.next()`。
3.  如果 `yield` 返回的是一个 `Promise` (或 `FutureTask`)，System 就暂停该协程，直到 Promise 完成。

```typescript
// 定义 Tween 组件
class Tween extends Component {
    elapsed: number = 0;
    constructor(
        public duration: number,
        public easing: (t: number) => number, // 缓动函数
        public onUpdate: (t: number, entity: Entity) => void, // 每帧回调
        public onComplete?: (entity: Entity) => void
    ) { super(); }
}

// --- Coroutine Helper ---
function* playButtonAnim(entity: Entity) {
    const style = entity.get(Style)!;
    
    // 1. 变大 (0.2s)
    // yield waitForTween(entity, { scale: 1.2 }, 0.2); 
    // 模拟底层实现: 创建一个 Tween 组件，并等待它销毁(完成)
    const tween = new Tween(entity, { scale: 1.2 }, 0.2);
    entity.add(tween);
    yield waitForComponentRemove(entity, Tween); 

    // 2. 变回 (0.1s)
    entity.add(new Tween(entity, { scale: 1.0 }, 0.1));
    yield waitForComponentRemove(entity, Tween);

    console.log("Animation Finished!");
}

// --- Usage ---
button.observe(ClickEvent, (trigger) => {
    // 启动协程
    trigger.entity!.add(new ScriptRunner(playButtonAnim(trigger.entity!)));
});
```
