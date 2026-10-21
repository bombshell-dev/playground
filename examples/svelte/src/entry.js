import { mount as mountComponent, unmount as unmountComponent, tick } from 'svelte';
import { writable } from 'svelte/store';
import Counter from './Counter.svelte';

export const state = writable({ label: 'initial', items: ['a', 'b'] });
export const lifecycle = [];
let application;

export async function mount() {
	application = mountComponent(Counter, {
		target: document.documentElement,
		props: { model: state, lifecycle },
	});
	await tick();
}

export async function update(label, items = ['b', 'a']) {
	await Promise.resolve();
	state.set({ label, items });
	await tick();
}

export async function settle() {
	await tick();
}

export async function unmount() {
	await unmountComponent(application);
}
