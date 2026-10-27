cmake_minimum_required(VERSION 3.22.1)
project(ftx264 C)

# Prebuilt x264 for this ABI, from ../../../x264/build.sh.
set(X264_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../x264/${ANDROID_ABI})
add_library(x264 STATIC IMPORTED)
set_target_properties(x264 PROPERTIES IMPORTED_LOCATION ${X264_DIR}/lib/libx264.a)

add_library(ftx264 SHARED x264_bridge.c)
target_include_directories(ftx264 PRIVATE ${X264_DIR}/include)
target_compile_options(ftx264 PRIVATE -O3 -Wall)
target_link_libraries(ftx264 x264 m)
# 16 KB page size (Android 15+ devices).
target_link_options(ftx264 PRIVATE "-Wl,-z,max-page-size=16384")
