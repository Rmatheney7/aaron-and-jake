<template>
  <div>

    {{greet()}}
   
  </div>
</template>

<script>
export default {
  data () {
    return {
      name: 'Aaron'
    }
  },
  methods:{
    greet() { 
      return 'Hi my name is ' + this.name;
    },
  }
}
</script>

<style>

</style>
