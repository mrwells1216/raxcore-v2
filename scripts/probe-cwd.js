import { readdirSync } from 'fs'
import { join } from 'path'

console.log('cwd:', process.cwd())
try { console.log('cwd contents:', readdirSync(process.cwd()).slice(0, 10)) } catch(e) { console.log('cwd read error:', e.message) }
try { console.log('/home contents:', readdirSync('/home').slice(0, 10)) } catch(e) { console.log('/home error:', e.message) }
try { console.log('/home/user contents:', readdirSync('/home/user').slice(0, 10)) } catch(e) { console.log('/home/user error:', e.message) }
