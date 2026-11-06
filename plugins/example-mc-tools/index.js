export default class McToolsPlugin {
  getTools() {
    return [
      {
        name: 'mc_server_status',
        description: '获取 FreeCore Minecraft 各子服运行状态与在线人数概况。',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        execute: async () => {
          return JSON.stringify({
            network: 'FreeCore Network',
            proxy: 'Velocity (Online)',
            servers: [
              { name: 'FreeCore-Survival', status: 'Online', tps: 20.0 },
              { name: 'FreeCore-Tech', status: 'Online', tps: 19.98 }
            ]
          }, null, 2);
        }
      }
    ];
  }
}
