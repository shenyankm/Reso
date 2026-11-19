import {execFileSync} from 'node:child_process'
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'

const action=process.argv[2]
if(!['init','build','install','build-server','install-server','build-roadshow','install-roadshow'].includes(action))throw new Error('Usage: node scripts/android.mjs init|build|install|build-server|install-server|build-roadshow|install-roadshow [emulator-serial]')
const variant=action.split('-')[1]||'local'
const roadshow=variant==='roadshow'
const suffix=variant==='local'?'':`:${variant}`
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(homedir(),'Library/Android/sdk')
if(!existsSync(join(sdk,'platform-tools')))throw new Error('Set ANDROID_HOME to an installed Android SDK')
const ndkRoot=join(sdk,'ndk')
const ndk=process.env.NDK_HOME||join(ndkRoot,readdirSync(ndkRoot).filter(name=>/^\d/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0]||'')
if(!existsSync(join(ndk,'source.properties')))throw new Error('Install Android NDK or set NDK_HOME')
const environment={...process.env,ANDROID_HOME:sdk,NDK_HOME:ndk}
if(roadshow)Object.assign(environment,{RESO_ROADSHOW_APK:'1',VITE_RESO_ROADSHOW_ONLY:'1'})
if(!environment.JAVA_HOME&&process.platform==='darwin')environment.JAVA_HOME=execFileSync('/usr/libexec/java_home',['-v','17'],{encoding:'utf8'}).trim()
const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb')
const run=(command,args)=>execFileSync(command,args,{env:environment,stdio:'inherit'})
const tauri=args=>run(process.execPath,['node_modules/@tauri-apps/cli/tauri.js',...args])
const artifact=resolve(`.data/android/Reso-${variant}-debug.apk`)
const outputDirectory='src-tauri/gen/android/app/build/outputs/apk/universal/debug'
function prepareResources(){
  cpSync('src-tauri/icons/android','src-tauri/gen/android/app/src/main/res',{recursive:true})
  const path='src-tauri/gen/android/app/src/main/AndroidManifest.xml'
  let manifest=readFileSync(path,'utf8')
  for(const permission of ['RECORD_AUDIO','MODIFY_AUDIO_SETTINGS']){
    if(!manifest.slice(0,manifest.indexOf('<application')).includes(`android.permission.${permission}`))manifest=manifest.replace(/<manifest\b[^>]*>/,opening=>`${opening}\n    <uses-permission android:name="android.permission.${permission}" />`)
  }
  manifest=manifest.replace(/<activity\b[^>]*>/,opening=>opening.includes('android:windowSoftInputMode=')?opening:opening.replace('<activity','<activity android:windowSoftInputMode="adjustResize"'))
  writeFileSync(path,manifest)
}


if(action==='init'){
  const activityPath='src-tauri/gen/android/app/src/main/java/app/reso/local/MainActivity.kt'
  const activity=existsSync(activityPath)?readFileSync(activityPath):null
  tauri(['android','init','--ci','--skip-targets-install'])
  if(activity)writeFileSync(activityPath,activity)
  prepareResources()
}else if(action.startsWith('build')){
  prepareResources()
  rmSync(outputDirectory,{recursive:true,force:true})
  const config=roadshow?[]:['--config',`src-tauri/tauri.${variant}.conf.json`]
  tauri(['android','build','--debug','--target','aarch64','--apk',...config,'--ci'])
  const apk=join(outputDirectory,'app-universal-debug.apk')
  if(!existsSync(apk))throw new Error('Android build completed without a debug APK')
  mkdirSync('.data/android',{recursive:true});copyFileSync(apk,artifact)
  console.log(`APK: ${artifact}`)
}else{
  if(!existsSync(artifact))throw new Error(`Run npm run android:build${suffix} first`)
  const devices=execFileSync(adb,['devices'],{encoding:'utf8'}).split('\n').filter(line=>/^emulator-\d+\s+device\b/.test(line)).map(line=>line.split(/\s+/)[0])
  const serial=process.argv[3]||(devices.length===1?devices[0]:null)
  if(!serial||!devices.includes(serial))throw new Error(`Start an AVD and select its serial: npm run android:install${suffix} -- emulator-5554`)
  if(variant==='local')run(adb,['-s',serial,'reverse','tcp:5173','tcp:5173'])
  run(adb,['-s',serial,'install','-r',artifact])
  run(adb,['-s',serial,'shell','am','start','-n',`app.reso.local${roadshow?'.roadshow':''}/app.reso.local.MainActivity`])
}
