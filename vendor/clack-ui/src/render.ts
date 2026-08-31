import { createApi } from './core.ts';

export const RenderApi = createApi('render', {
	requestRender(_): void {},
});

export const { requestRender } = RenderApi.methods;
