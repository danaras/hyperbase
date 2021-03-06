var EventEmitter = require('events')
var HList = null // require() can't handle circular deps so we grab this at runtime

module.exports = class HMap extends EventEmitter {
  constructor (opts) {
    super()
    if (HList === null) {
      HList = require('./list')
    }
    this.onvalue = this.onvalue.bind(this)
    this.onchange = this.onchange.bind(this)
    this.key = opts.key
    this.prefix = opts.prefix ? (opts.prefix + '/') : ''
    this.storage = opts.storage
    this._links = opts.link
    this.debounce = opts.debounce === undefined ? 25 : opts.debounce
    this.children = {}
    this._watch = setTimeout(() => this.watch())
  }

  get loading () {
    if (this.data === undefined) return true
    for (var key in this.children) {
      var child = this.children[key]
      if (child.loading) return true
    }
    return false
  }

  get loaded () {
    return !this.loading
  }

  get notFound () {
    return this.data === null
  }

  get link () {
    return this._links
  }

  set link (opts) {
    this._links = opts
    this.update()
  }

  watch () {
    this.ref = this.storage.child(this.prefix + this.key)
    this.ref.on('value', this.onvalue)
  }

  unwatch () {
    clearTimeout(this._watch)
    if (!this.ref) return
    this.ref.off('value', this.onvalue)
    for (var key in this.children) {
      this.children[key].unwatch()
    }
    this.children = {}
  }

  update () {
    this.onvalue({ val: () => this.data })
  }

  serialize () {
    var data = this.data ? JSON.parse(this.hash) : {}
    this.forEachLink(this.links, data, (location, property, opts) => {
      location[property] = this.children[location[property]].serialize()
    })
    Object.defineProperty(data, 'key', {
      enumerable: false,
      get: () => this.key
    })
    return data
  }

  delete () {
    if (this.loading) throw new Error('cannot delete items that have not loaded')
    var patch = {
      [this.key]: null
    }
    this.forEachLink(this.links, this.data, (location, property, opts) => {
      Object.assign(
        patch,
        this.children[location[property]].delete()
      )
    })
    return patch
  }

  onvalue (snap) {
    var data = snap.val()
    var hash = JSON.stringify(data)
    var changed = this.data === undefined || hash !== this.hash
    this.data = data
    this.hash = hash
    var links = {}
    this.forEachLink(this.links, data, (location, property, opts) => {
      links[location[property]] = opts
    })
    for (var key in this.children) {
      if (!links[key]) {
        changed = true
        var child = this.children[key]
        child.removeListener('change', this.onchange)
        child.unwatch()
        delete this.children[key]
      }
    }
    for (key in links) {
      var opts = links[key]
      child = this.children[key]
      if (!child) {
        changed = true
        var Klass = opts.type === 'list' ? HList : HMap
        child = this.children[key] = new Klass(Object.assign({
          key,
          storage: this.storage,
          debounce: 0
        }, opts))
        child.on('change', this.onchange)
      }
    }
    if (changed) {
      this.onchange()
    }
  }

  forEachLink (links, data, cb) {
    for (var path in links) {
      var opts = links[path]
      var pointers = [ data ]
      var components = path.split('/')
      components.forEach((component, i) => {
        var last = i === components.length - 1
        var nextPointers = []
        pointers.forEach(pointer => {
          if (!pointer || typeof pointer !== 'object') return
          if (component === '*') {
            for (var property in pointer) {
              if (pointer[property] !== undefined) {
                if (last) {
                  cb(pointer, property, opts)
                } else {
                  nextPointers.push(pointer[property])
                }
              }
            }
          } else if (pointer[component] !== undefined) {
            if (last) {
              cb(pointer, component, opts)
            } else {
              nextPointers.push(pointer[component])
            }
          }
        })
        pointers = nextPointers
      })
    }
  }

  onchange (evt) {
    if (this.debounce) {
      clearTimeout(this._debounce)
      this._debounce = setTimeout(() => {
        this.emit('change', evt || this)
      }, this.debounce)
    } else {
      this.emit('change', evt || this)
    }
  }
}
