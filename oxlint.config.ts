import config from './node_modules/@bomb.sh/tools/oxlintrc.json' with { type: 'json' };

export default {
	...config,
	jsPlugins: ['./node_modules/@bomb.sh/tools/rules/plugin.js'],
};
