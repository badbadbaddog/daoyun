(component
  (core module $module
    (memory (export "memory") 1)
    (global $next (mut i32) (i32.const 1024))
    (func (export "realloc") (param $old i32) (param $old_size i32)
          (param $align i32) (param $new_size i32) (result i32)
      (local $result i32)
      global.get $next
      local.tee $result
      local.get $new_size
      i32.add
      global.set $next
      local.get $result)
    (func (export "invoke") (param i32 i32 i32) (result i32)
      i32.const 0
      local.get 1
      i32.store
      i32.const 4
      local.get 2
      i32.store
      i32.const 0)
    )
  (core instance $instance (instantiate $module))
  (alias core export $instance "memory" (core memory $memory))
  (alias core export $instance "realloc" (core func $realloc))
  (alias core export $instance "invoke" (core func $invoke_core))
  (type $operation_raw (enum "content-transform" "ui-render"))
  (export $operation "operation" (type $operation_raw))
  (type $invoke_type (func
    (param "operation" $operation)
    (param "payload" (list u8))
    (result (list u8))))
  (func $invoke (type $invoke_type)
    (canon lift (core func $invoke_core)
      (memory $memory)
      (realloc $realloc)))
  (export "invoke" (func $invoke)))
