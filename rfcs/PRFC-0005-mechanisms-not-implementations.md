# PRFC-0005 依赖机制，而不是实现

> **来源**：设计仓库 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0005-mechanisms-not-implementations.md`——草案，居设计分支 `docs/mechanisms`（其自身的 PR [#109](https://github.com/Prism-Shadow/penguin-harness-design/pull/109) 已作为草稿关闭；该稿现为 open 设计 PR [#113](https://github.com/Prism-Shadow/penguin-harness-design/pull/113) 与 [#123](https://github.com/Prism-Shadow/penguin-harness-design/pull/123) 的栈底）。
> **Rev**：v1.0.0（迁入主仓，取该草案当前版本）；本面约定见 [README.zh.md](README.zh.md)，逐版改动记于文末 `## Changes`。

- Feature Name: `mechanisms-not-implementations`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#109](https://github.com/Prism-Shadow/penguin-harness-design/pull/109)
- Implementation PR: [Prism-Shadow/penguin-harness#546](https://github.com/Prism-Shadow/penguin-harness/pull/546)
- 依赖: PRFC-0001「Module」

## Summary
[summary]: #summary

模块树里的节点只依赖**机制**——一个只有签名的接口类——而不依赖实现那个机制的组件。工具守这条规则：`@Use` 字段的类型是组件即为错误。随之而来的是三件事：测试替身成为机制的第二个实现而不是一口袋可选项、树按组划分并只导出该导出的、以及整组或单个节点都可以被外来的扩展替换。

## Motivation
[motivation]: #motivation

### 树建起来了，但它描述的是「谁 new 了谁」

PRFC-0001 把服务端按 Module 组织成一棵树之后，`ifaces.json` 第一次让依赖关系可以被数出来。数出来的结果不好看：

改动之前，按当时的 `ifaces.json` 数下来，**过半的 `requires` 指向实现类**——`UsersRepo`、`SessionsRepo`、`ProjectConfigService` 这些——指向接口的不到一半。也就是说这棵树记录的是「谁 new 了谁」，不是「谁需要什么机制」。`AuthService` 说的是「我要 sqlite 上的 `UsersRepo`」，而它想说的其实是「我要一个 `Users`」。

一个节点导出了十样互不相干的东西。`RuntimeModule` 一个节点同时给出 config、db、channels、proxy、hmr、desktop、authState、overrides、log、resourceGroups。要它 `Config` 的节点有二十来个，其中绝大多数只用到 `config.root` 一个字段；要它 `Db` 的是全部 repo。

**最难看的一条：十几个节点依赖 `Overrides`。** 那是测试注入——`now`、`passwordHashCost`、`feishuSdk`、`qqTransport`——它们大摇大摆地走在生产依赖图里。要给测试一个假时钟，就得让生产代码承认自己有一个可以被换掉的时钟口袋。

### 还有一个形状问题

树建好之后，每一样东西都成了节点，而节点之间是平的：没有分组，没有可见性，谁都能被谁依赖。于是「这个模块被谁依赖」这个问题失去了意义——所有模块看上去都不被依赖，因为大家依赖的都是接口，而接口不属于任何模块。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 三条规则

**节点只依赖接口类。** `@Use()` 字段的类型必须是一个接口类——`@Interface()` 装饰的，或者 `extends Interface<T>()` 的。生成器把「类型是组件」当作错误，所以这条规则是结构性的，不靠 review 记得。

**机制由它的 owner 声明，实现只是一个组件。** `Users` 这个接口属于身份机制；sqlite 上的 `UsersRepo` 是它的一个实现，写作 `class UsersRepo implements Users`。消费者永远 `import type { Users }`，从不 import 那个 repo 文件——`import` 的路径本身就说明它依赖的是机制，不是存储技术。

**组件声明它实现什么。** 生成器读 `implements` 子句，把接口记进该节点的 `provides`；接线优先按声明的 provides，找不到再按结构。TypeScript 检查形状，生成器检查签名投影，启动器检查运行时存在——同一条规则的三层。

消费者还可以就地声明更窄的接口（Go 的做法）：auth 只需要三个配置字段，就在自己旁边声明一个 `AuthPolicy`，谁满足谁来接，不必等 owner 先把大接口切细。

### 测试替身是机制的第二个实现

`BuildDepsOverrides` 删除。它原来的每一项都变成一个接口加两个实现：

| 原 Overrides 字段 | 机制 | 生产实现 | 测试实现 |
| --- | --- | --- | --- |
| `now` | `Clock` | `SystemClock` | `FakeClock` |
| `passwordHashCost` | `PasswordHasher` | `ScryptHasher` | 低成本的那个 |
| `feishuSdk`、`qqTransport` 等 | 各连接器的 `Transport` | 真网络 | fake |
| `machines`、`updateCheck` | `MachineEffects`、`UpdateCheckTransport` | 真 ssh / fetch | fake |

测试用 `bootAppDeps(config, [[SystemClock, { now }]])` 把替身放进树，替身像节点本身一样被校验。「运行时读一口袋可选项」这种形态消失了，每个替身都是树里一个有名字、有签名的节点，在 `ifaces.json` 里看得见。

### 树有了形状

根下按机制分组，每组是一个 `@Module({ children, exports })`。**导出的接口由声明它的那个 child 转出，组里其余节点只在组内可见**——可见性是词法的：兄弟，以及祖先的兄弟，但不含祖先自己。

整组可以被替换，组里任一节点也可以。启动顺序跟随**被导出的 child** 而不是组本身，否则身份组与项目组各自需要对方的一个 child 就成了环。生成器把每条 `requires` 静态解析到提供它的模块，记进 `from`——「谁依赖谁」于是重新可见，而且是从表里数出来的，不靠人去记。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 接口放在哪

一处放齐：`src/mechanisms/<组>.ts`，只有抽象类，每个机制一个、带完整签名；sqlite 实现留在 `db/repos/*.ts` 并 `implements` 它们。这一点是对最初设计的一处修订——原本打算按 owner 目录分散放置，实践下来一处放齐更容易读。消费者自己声明的窄接口仍然紧挨消费者。

结果是**没有任何一个 `@Use` 字段指向实现**，而生成器让这种字段成为错误——所以这不是一次清理的成绩，是一条守得住的规则。

### 不透明身份

一个宿主类型写作 `<声明它的包>#<名字>`，从不是一个裸名字：`@types/node#Request`、`@prismshadow/penguin-core#Resources`。映射类型（`Pick<…>`、`Record<…>`）按它们展开后的形状投影；一个带方法的别名按它自己的名字投影成接口。清单记录每个节点的种类，页面据此标出组件、模块与导出组。

### 外来扩展的热替换

一个扩展是 `{ modules?, replaces? }`。`package.json#penguin.replaces` 以**被替换节点的名字**列出替身的清单——被替换的可以是一个组件、一个模块，也可以是一整个带 children 与 exports 的组。

替身放进去的时候不看原来的类；放好之后，整棵组装出来的树在任何节点运行之前被校验一遍：requires 按签名解析，exports 落到某个 child 上，provides 在实例上确实存在。一个提供得比消费者需要的少的替身，会被**具名拒绝**。两个扩展替换同一个节点是加载期冲突。

生产代码与测试助手一律经组的 exports 读树，从不按名字去拿某个实现节点。

## Drawbacks
[drawbacks]: #drawbacks

**接口的数量翻了一倍多。** 一处放齐的那批机制接口，加上消费者自己声明的窄接口，都是要维护的东西；改一个方法签名要动接口与实现两处。

**一处放齐是一次权衡。** `src/mechanisms/` 好读，但它也是一个所有人都会改的目录，容易成为冲突点，而且接口离它的实现远了。

**词法可见性是新的一条规则**，读代码的人得知道「组内可见、祖先不可见」这件事，否则会困惑于为什么某个节点拿不到看上去就在旁边的东西。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**靠 review 守规则**——约定「@Use 只写接口」，不动生成器。改动之前那过半的实现依赖，本身就是这条路的结果：约定在赶工时最先失效。让工具把它变成错误，规则才是结构性的。

**把 `Overrides` 留着但收窄**——只保留真正需要注入的几项。仍然是同一个毛病：生产依赖图里有一个专为测试而存在的口袋，而且没有边界能说明哪几项算「真正需要」。

**不分组，保持平铺**——省掉可见性与导出转发这一层。代价是任何节点都能依赖任何节点，「谁依赖谁」永远答不上来，而且没有可替换的粒度：想换掉一整块，只能一个节点一个节点换。

**替身按名字注册而不进树**——一个全局的替换表。那样替身就不受整树校验，替身缺一个方法要到调用时才发现，正是 PRFC-0001 要消灭的那类失败。

## Prior art
[prior-art]: #prior-art

**Go 的窄接口惯例**——「接口属于消费者，不属于实现者」——是「消费者可以就地声明更窄的接口」那条的来源。本设计比 Go 多一层：owner 也声明一份，因为跨热推边界的替换需要一个双方都点名的东西。

**OSGi 的服务可见性**做过同样的分组与导出：一个 bundle 显式导出它的包，其余对外不可见。差别是 OSGi 以 ClassLoader 实施，我们以词法规则加校验实施。

**依赖注入容器**（NestJS、Spring）通常允许按具体类注入，也允许按接口；两者都合法，因此实践中总会滑向具体类。这里把「按实现注入」直接定为错误，是有意识地不给这条滑坡留口子。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

`ProjectConfig` 还可以按消费者再切——调度器只要 `getModels` 与 `getPricing`，访问控制只要 `getName`——切到什么粒度为止没有定论。切得太细，接口比方法还多。

`src/mechanisms/` 一处放齐会不会成为冲突热点，要等它被几个人同时改过才知道；真成了问题，退回按 owner 目录分散是可逆的。

## Future possibilities
[future-possibilities]: #future-possibilities

组的可替换性给了部署方一条今天还没人走的路：把一整组换成自己的实现——例如把身份组换成对接企业目录服务的一份——而不必碰平台其余部分。这条路的入口已经在（`replaces` 接受一整个组），缺的是有人真的需要它时该有的文档与例子。

## Changes

### v1.0.0

- Added: 迁入主仓；正文取设计分支 docs/mechanisms 所携草案的当前版本，与来源文件一致。
