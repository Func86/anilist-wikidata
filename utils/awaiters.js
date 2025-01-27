
class BaseAwaiter {
	waitUntil(task, desc) {
		throw new Error('The `waitUntil` method must be implemented.');
	}

	async waitAll() {
		throw new Error('The `waitAll` method must be implemented.');
	}

	async do() {
		throw new Error('The `do` method must be implemented.');
	}

	async sleep(desc, ms) {
		console.log(desc);
		return new Promise(resolve => {
			setTimeout(resolve, ms);
		});
	}
}

class WorkerAwaiter extends BaseAwaiter {
	constructor(ctx) {
		super();
		this.ctx = ctx;
	}

	waitUntil(task, desc) {
		if (desc) {
			console.log(desc);
		}
		this.ctx.waitUntil(task);
	}

	async waitAll() {
		// NO-OP
	}

	async do(...args) {
		console.log(args[0]);
		return (args.pop())();
	}
}

class WorkflowAwaiter extends BaseAwaiter {
	tasks = []
	constructor(step) {
		super();
		this.step = step;
	}

	waitUntil(task, desc) {
		desc ??= 'waitUntil';
		this.tasks.push(this.step.do(desc, async () => {
			await task;
		}));
	}

	async waitAll() {
		if (this.tasks.length > 0) {
			await Promise.allSettled(this.tasks);
			this.tasks = [];
		}
	}

	async do(...args) {
		return this.step.do(...args);
	}

	async sleep(desc, ms) {
		return this.step.sleep(desc, ms);
	}
}

class NodeAwaiter extends BaseAwaiter {
	tasks = []

	waitUntil(task, desc) {
		if (desc) {
			console.log(desc);
		}
		this.tasks.push(task);
	}

	async waitAll() {
		if (this.tasks.length > 0) {
			await Promise.allSettled(this.tasks);
			this.tasks = [];
		}
	}

	async do(...args) {
		console.log(args[0]);
		return (args.pop())();
	}
}

export { BaseAwaiter, WorkerAwaiter, WorkflowAwaiter, NodeAwaiter };
