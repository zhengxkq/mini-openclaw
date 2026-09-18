export class ToolCallAccumulator {
  #calls = new Map();

  add(deltas) {
    for (const delta of deltas) {
      if (!this.#calls.has(delta.index)) {
        this.#calls.set(delta.index, {
          id: delta.id,
          name: "",
          arguments: ""
        });
      }

    const call = this.#calls.get(delta.index);
    if (delta.id) call.id = delta.id;
    call.name += delta.function?.name ?? "";
    call.arguments += delta.function?.arguments ?? "";
    }
  }

  build() {
    return [...this.#calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments }
      }));
  }
}