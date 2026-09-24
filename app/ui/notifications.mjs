export function notifications(root) {
  let timer;
  const dismiss = () => {clearTimeout(timer); root.classList.add('hidden');};
  root.querySelector('button').onclick = dismiss;
  return (message, success = false) => {
    clearTimeout(timer);
    root.querySelector('span').textContent = message;
    root.classList.toggle('success', success);
    root.classList.remove('hidden');
    timer = setTimeout(dismiss, success ? 5000 : 8000);
  };
}
