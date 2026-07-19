import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname,
	source = `${root}/native/pty-host-c`,
	cache = `${root}/.cache/hosts`,
	artifacts = `${root}/artifacts`,
	sources = [`${source}/main.c`, `${source}/protocol.c`, `${source}/session.c`];
await mkdir(cache, { recursive: true });
await mkdir(artifacts, { recursive: true });

if (process.platform === 'darwin') {
	for (const architecture of ['arm64', 'x86_64'] as const) {
		const target = architecture === 'x86_64' ? 'x64' : architecture,
			output = `${artifacts}/pty-host-darwin-${target}`;
		await $`xcrun clang -std=c17 -O2 -Wall -Wextra -Werror -arch ${architecture} ${sources} -o ${output}`;
		await $`chmod +x ${output}`;
	}
	await $`cp ${artifacts}/pty-host-darwin-${process.arch} ${cache}/pty-host-c`;
} else if (process.platform === 'linux') {
	const compiler = process.env.CC ?? 'musl-gcc',
		target = `linux-${process.arch}`,
		output = `${artifacts}/pty-host-${target}`;
	await $`${compiler} -std=c17 -O2 -Wall -Wextra -Werror -static ${sources} -o ${output}`;
	await $`chmod +x ${output}`;
	await $`cp ${output} ${cache}/pty-host-c`;
} else {
	throw new Error(`unsupported C host build platform ${process.platform}-${process.arch}`);
}

console.log(`${cache}/pty-host-c`);
