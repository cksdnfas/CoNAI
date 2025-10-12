import React, { useState } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import Masonry from 'react-masonry-css';
import InfiniteScroll from 'react-infinite-scroll-component';
import type { ImageRecord } from '../../types/image';
import MasonryImageCard from './MasonryImageCard';
import ImageViewerModal from '../ImageViewerModal';
import './ImageMasonry.css';

interface ImageMasonryProps {
  images: ImageRecord[];
  loading?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

const ImageMasonry: React.FC<ImageMasonryProps> = ({
  images,
  loading = false,
  hasMore,
  onLoadMore,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // react-masonry-css breakpoint 설정
  const breakpointColumns = {
    default: 6, // xl
    1536: 5,    // lg+
    1200: 4,    // lg
    900: 3,     // md
    600: 2,     // sm
  };

  const handleImageClick = (imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setViewerOpen(true);
  };

  const handleImageChange = (newIndex: number) => {
    setCurrentImageIndex(newIndex);
  };

  // 초기 로딩 중
  if (loading && images.length === 0) {
    return (
      <Box sx={{ width: '100%' }}>
        <Masonry
          breakpointCols={breakpointColumns}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {Array.from({ length: 20 }, (_, index) => (
            <Skeleton
              key={index}
              variant="rectangular"
              height={Math.random() * 200 + 150}
              sx={{ borderRadius: 1 }}
            />
          ))}
        </Masonry>
      </Box>
    );
  }

  // 이미지가 없는 경우
  if (images.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          이미지가 없습니다
        </Typography>
        <Typography variant="body2" color="text.secondary">
          이미지를 업로드해보세요.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <InfiniteScroll
        dataLength={images.length}
        next={onLoadMore}
        hasMore={hasMore}
        loader={
          <Box sx={{ mt: 2, width: '100%' }}>
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                이미지를 불러오는 중...
              </Typography>
            </Box>
          </Box>
        }
        endMessage={
          <Box sx={{ textAlign: 'center', py: 4, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              모든 이미지를 불러왔습니다
            </Typography>
          </Box>
        }
        scrollThreshold={0.8}
        style={{ overflow: 'visible' }}
      >
        <Masonry
          breakpointCols={breakpointColumns}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {images.map((image, index) => (
            <MasonryImageCard
              key={image.id}
              image={image}
              onClick={() => handleImageClick(index)}
            />
          ))}
        </Masonry>
      </InfiniteScroll>

      {/* 이미지 뷰어 모달 */}
      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        image={images[currentImageIndex] || null}
        images={images}
        currentIndex={currentImageIndex}
        onImageChange={handleImageChange}
      />
    </Box>
  );
};

export default ImageMasonry;
