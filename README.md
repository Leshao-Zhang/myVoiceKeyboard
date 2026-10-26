# myVoiceKeyboard

按下 A–Z、0–9 或方向键，播放对应的读音。Mac 和 Windows 都用桌面应用「语音键盘」。关掉窗口后仍会读，从菜单栏或系统托盘退出才停止。

## 直接打开

这台 Apple 芯片的 Mac：双击 `打开语音键盘.command`，或打开 `dist/mac-arm64/VoiceKeyboard.app`（访达里显示为「语音键盘」）。Intel Mac 用 `dist/VoiceKeyboard-1.0.0-mac-x64.dmg`。

第一次要在「系统设置 → 隐私与安全性」里允许「语音键盘」的辅助功能。如果按键没有声音，再到输入监控里同样允许，然后重新打开。

Windows：把 `dist/VoiceKeyboard-1.0.0-win-x64.zip` 拷过去解压，运行里面的 `VoiceKeyboard.exe`。若系统提示不受信任，选择仍要运行。

按键仍会输入到当前软件。密码框处于系统安全输入时不会出声。

## 开发

```bash
cd app
npm install
npm start
```

打包：

```bash
npm run build:mac
npm run build:win
```

产物在 `dist/`。

## 前台网页

`keyboard/index.html` 只在这个页面处于前台时能收到按键。日常使用请打开桌面应用。
