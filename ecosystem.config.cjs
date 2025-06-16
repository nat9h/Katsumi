module.exports = {
	apps: [
		{
			script: "src/main.js",
			name: "Katsumi",
			node_args: "--env-file .env --max-old-space-size=256",
			max_memory_restart: "300M",
			exp_backoff_restart_delay: 1000,
			min_uptime: 5000,
			max_restarts: 5,
			watch: false,
			instances: 1,
			exec_mode: "fork",
		},
	],
};
