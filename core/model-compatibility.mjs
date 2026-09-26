/** Flag weights crossing the original model's visibility variants without changing them. */
export function modelCompatibility(info, choices) {
  const issues = [];
  for (const choice of choices) {
    const input = info.inputs[choice.input], template = info.templates[choice.template];
    if (!input || !template) continue;
    const bones = input.bones.filter(bone => {
      const variants = info.boneVariants[bone];
      return variants?.length && !variants.includes(0) && !variants.includes(template.visibility);
    });
    if (bones.length) issues.push({input: input.index, name: input.name, template: template.name, visibility: template.visibility, bones});
  }
  return issues;
}
