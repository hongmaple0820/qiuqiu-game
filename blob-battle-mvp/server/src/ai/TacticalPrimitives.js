/**
 * Tactical Primitives - 标准战术原语库
 * 定义五种标准战术及其角色分配逻辑
 * pincer_attack / bait / merge_rally / feed / screen
 * 对应 REQ-6.AC4
 */

const TacticalPrimitives = {
  /**
   * 夹击: 两个以上成员从不同方向逼近同一目标
   */
  pincer_attack: {
    name: 'pincer_attack',
    minMembers: 2,
    description: '两个以上成员从不同方向逼近同一目标',

    /** 为参与者分配角色 */
    assignRoles(members, targetPosition) {
      const roles = {};
      if (members.length < 2) return roles;

      roles[members[0]] = 'left_flank';
      roles[members[1]] = 'right_flank';

      // 剩余成员作为支援
      for (let i = 2; i < members.length; i++) {
        roles[members[i]] = 'support';
      }
      return roles;
    },

    /** 计算某角色的目标位置 */
    getRoleTarget(role, targetPosition, memberPosition) {
      switch (role) {
        case 'left_flank':
          return { x: targetPosition.x - 150, y: targetPosition.y - 80 };
        case 'right_flank':
          return { x: targetPosition.x + 150, y: targetPosition.y - 80 };
        case 'support':
          return { x: targetPosition.x, y: targetPosition.y - 200 };
        default:
          return targetPosition;
      }
    },

    /** 评估此战术对某成员的价值 */
    evaluate(perception, targetId, memberRole) {
      const target = perception.visibleEntities.find(e => e.entity_id === targetId);
      if (!target) return 0;
      if (target.type !== 'enemy') return 0;
      // 只有多队友在场才值得夹击
      const allyCount = perception.getAllies().length;
      if (allyCount < 1) return 0.3;
      return 0.8;
    },
  },

  /**
   * 诱饵: 故意暴露较小的球吸引敌人,引导入队友包围圈
   */
  bait: {
    name: 'bait',
    minMembers: 2,
    description: '小质量球暴露吸引敌人追击,引导其进入队友包围圈',

    assignRoles(members, targetPosition) {
      const roles = {};
      if (members.length < 2) return roles;

      // 最小的成员做诱饵
      roles[members[0]] = 'bait';
      roles[members[1]] = 'ambusher';
      for (let i = 2; i < members.length; i++) {
        roles[members[i]] = 'ambusher';
      }
      return roles;
    },

    getRoleTarget(role, targetPosition, memberPosition) {
      switch (role) {
        case 'bait':
          // 诱饵向目标靠近 但保持距离
          return {
            x: targetPosition.x + (memberPosition.x - targetPosition.x) * 0.5,
            y: targetPosition.y + (memberPosition.y - targetPosition.y) * 0.5,
          };
        case 'ambusher':
          // 伏击者藏在目标身后
          return {
            x: targetPosition.x + 200,
            y: targetPosition.y + 200,
          };
        default:
          return targetPosition;
      }
    },

    evaluate(perception, targetId, memberRole) {
      if (memberRole !== 'bait') return 0.5;
      return 0.6;
    },
  },

  /**
   * 合体冲锋: 多个分裂体在指定时间点合并增强质量再突击
   */
  merge_rally: {
    name: 'merge_rally',
    minMembers: 1,
    description: '多个分裂体在指定时间点合并增强质量再突击',

    assignRoles(members, targetPosition) {
      const roles = {};
      if (members.length === 0) return roles;
      roles[members[0]] = 'merger';
      for (let i = 1; i < members.length; i++) {
        roles[members[i]] = 'cover';
      }
      return roles;
    },

    getRoleTarget(role, targetPosition, memberPosition) {
      if (role === 'merger') {
        // 合并者向目标移动
        return targetPosition;
      }
      // 掩护者在目标周围巡逻
      return {
        x: targetPosition.x + Math.cos(Date.now() / 1000) * 150,
        y: targetPosition.y + Math.sin(Date.now() / 1000) * 150,
      };
    },

    evaluate(perception, targetId, memberRole) {
      if (memberRole === 'merger') return 0.7;
      return 0.4;
    },
  },

  /**
   * 投喂: 吐孢子给队友补质量
   */
  feed: {
    name: 'feed',
    minMembers: 2,
    description: '吐孢子给队友补质量,常用于养肥主力分体',

    assignRoles(members, targetPosition) {
      const roles = {};
      if (members.length < 2) return roles;
      roles[members[0]] = 'donor';
      roles[members[1]] = 'receiver';
      return roles;
    },

    getRoleTarget(role, targetPosition, memberPosition) {
      if (role === 'donor') {
        // 施主向接收者靠近
        return targetPosition;
      }
      // 接收者原地等待
      return memberPosition;
    },

    evaluate(perception, targetId, memberRole) {
      if (memberRole === 'receiver') return 0.9;
      if (memberRole === 'donor') return 0.5;
      return 0.3;
    },
  },

  /**
   * 掩护: 用自身质量挡住追兵路径
   */
  screen: {
    name: 'screen',
    minMembers: 2,
    description: '用自身质量挡住追兵路径,为队友争取逃脱时间',

    assignRoles(members, targetPosition) {
      const roles = {};
      if (members.length < 2) return roles;
      roles[members[0]] = 'screener';
      roles[members[1]] = 'escaper';
      return roles;
    },

    getRoleTarget(role, targetPosition, memberPosition) {
      if (role === 'screener') {
        // 掩护者插入目标和逃跑者之间
        return {
          x: (targetPosition.x + memberPosition.x) / 2,
          y: (targetPosition.y + memberPosition.y) / 2,
        };
      }
      // 逃跑者向远离目标方向移动
      const dx = memberPosition.x - targetPosition.x;
      const dy = memberPosition.y - targetPosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: memberPosition.x + (dx / dist) * 300,
        y: memberPosition.y + (dy / dist) * 300,
      };
    },

    evaluate(perception, targetId, memberRole) {
      if (memberRole === 'screener') return 0.8;
      if (memberRole === 'escaper') return 0.95;
      return 0.5;
    },
  },
};

/** 验证战术提案名称 */
function isValidProposal(name) {
  return Object.keys(TacticalPrimitives).includes(name);
}

/** 获取战术定义 */
function getPrimitive(name) {
  return TacticalPrimitives[name] || null;
}

module.exports = { TacticalPrimitives, isValidProposal, getPrimitive };
