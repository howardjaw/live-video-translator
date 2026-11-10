export function clockAction(video:{paused:boolean;ended:boolean;seeking:boolean;readyState:number;currentTime:number;playbackRate:number},audioTime:number){
 return {pause:video.paused||video.ended||video.seeking||video.readyState<3,seek:Math.abs(video.currentTime-audioTime)>.1,time:video.currentTime,rate:video.playbackRate};
}
