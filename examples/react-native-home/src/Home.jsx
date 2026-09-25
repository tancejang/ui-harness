import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, StatusBar } from 'react-native';
import proof from '../.uih/runtime/revision.json';

export default function Home() {
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState('Home');
  return <View style={styles.screen}>
    <StatusBar barStyle="dark-content" backgroundColor="#faf8f5" />
    <View testID={`uih-revision-${proof.revision}`} collapsable={false} style={styles.content}>
      <View style={styles.header}><Text style={styles.eyebrow}>YOUR EVERYDAY WARDROBE</Text><Text style={styles.title}>Good morning, Alex</Text><Text style={styles.subtitle}>A little inspiration for your day.</Text></View>
      <View style={styles.card}><Text style={styles.tag}>TODAY'S EDIT</Text><View style={styles.outfit}><View style={styles.shirt}/><View style={styles.trousers}/></View><Text style={styles.cardTitle}>The effortless weekend</Text><Text style={styles.description}>Soft layers. Familiar favorites. Entirely you.</Text><Pressable testID="save-outfit" accessibilityRole="button" onPress={() => setSaved(!saved)} style={styles.button}><Text style={styles.buttonText}>{saved ? 'Saved to your wardrobe' : 'Save this outfit'}</Text></Pressable></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Make it your own</Text><Text style={styles.description}>Rediscover what you already love.</Text></View>
      <View style={styles.tiles}><View style={styles.tile}><Text style={styles.tileTitle}>Your wardrobe</Text><Text style={styles.description}>24 pieces, endless possibilities</Text></View><View style={styles.tile}><Text style={styles.tileTitle}>Saved looks</Text><Text style={styles.description}>A place for your favorites</Text></View></View>
      <Text testID="active-tab" style={styles.state}>{tab === 'Home' ? 'Ready for today' : 'Your wardrobe is ready'}</Text>
    </View>
    <View style={styles.navigation}>{['Home','Wardrobe','Looks'].map(name => <Pressable key={name} testID={`tab-${name.toLowerCase()}`} accessibilityRole="tab" accessibilityState={{selected:tab===name}} onPress={()=>setTab(name)}><Text style={[styles.navText,tab===name&&styles.active]}>{name}</Text></Pressable>)}</View>
  </View>;
}
const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#faf8f5'},content:{flex:1,paddingHorizontal:24,paddingTop:32},header:{marginBottom:26},eyebrow:{fontSize:10,letterSpacing:2,color:'#797068',fontWeight:'600'},title:{fontSize:29,fontWeight:'600',color:'#242424',marginTop:10},subtitle:{fontSize:14,color:'#797068',marginTop:9},card:{backgroundColor:'#e7e3d9',borderRadius:20,padding:20},tag:{fontSize:10,letterSpacing:2,color:'#666454'},outfit:{height:150,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:16},shirt:{width:82,height:85,borderRadius:18,backgroundColor:'#fdfcf8',transform:[{rotate:'-8deg'}]},trousers:{width:66,height:118,borderRadius:10,backgroundColor:'#72796a',transform:[{rotate:'7deg'}]},cardTitle:{fontSize:22,fontWeight:'600',color:'#242424'},description:{fontSize:12,color:'#797068',marginTop:7,lineHeight:18},button:{backgroundColor:'#263d32',borderRadius:12,paddingVertical:15,alignItems:'center',marginTop:18},buttonText:{color:'#ffffff',fontSize:13,fontWeight:'600'},section:{marginTop:27},sectionTitle:{fontSize:20,fontWeight:'600',color:'#242424'},tiles:{flexDirection:'row',gap:12,marginTop:16},tile:{flex:1,backgroundColor:'#ffffff',padding:15,borderRadius:14},tileTitle:{fontSize:14,fontWeight:'600',color:'#242424'},state:{fontSize:10,color:'#9b938a',marginTop:18},navigation:{flexDirection:'row',justifyContent:'space-around',paddingVertical:20,borderTopWidth:1,borderTopColor:'#e6e1da'},navText:{color:'#918b84',fontSize:12},active:{color:'#263d32',fontWeight:'700'}
});
